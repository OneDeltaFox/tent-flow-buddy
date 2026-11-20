import { expect, test } from "@playwright/test";

for (const state of ["open", "full", "closed"] as const) {
  test(`Incoming arrival button handles a ${state} planned pod`, async ({page}) => {
    await page.setViewportSize({width:390,height:844});
    await page.addInitScript(()=>localStorage.setItem("tent-flow-dev-auth",JSON.stringify({access_token:"token",refresh_token:"refresh",token_type:"bearer",expires_at:Math.floor(Date.now()/1000)+3600,user:{id:"user"}})));
    const snapshot:any={pods:[{id:"pod",name:"Pod 1",kind:"regular",color:"#facc15",capabilities:[],closed:state==="closed",beds:[{id:"bed",label:"1-1",status:state==="full"?"occupied":"open"}]}],visits:[{id:"patient",bib:"123",triage:"untriaged",complaint:"",planned_pod_id:"pod",revision:1,medical_started_at:null,dispositioned_at:null}],placements:[],turnovers:[]};
    await page.route("**/rest/v1/rpc/my_races",route=>route.fulfill({json:[{id:"race",name:"Test",role:"editor",state:"active"}]}));
    await page.route("**/rest/v1/rpc/patient_board",route=>route.fulfill({json:snapshot}));
    let moves=0;
    await page.route("**/rest/v1/rpc/move_patient",async route=>{
      moves++;
      expect(route.request().postDataJSON()).toMatchObject({p_visit:"patient",p_revision:1,p_action:"assigned",p_bed:"bed"});
      snapshot.visits[0].planned_pod_id=null;
      snapshot.visits[0].medical_started_at=new Date().toISOString();
      snapshot.placements=[{visit_id:"patient",bed_id:"bed",ended_at:null,kind:"regular",started_at:new Date().toISOString()}];
      snapshot.pods[0].beds[0].status="occupied";
      await route.fulfill({json:2});
    });
    await page.goto("/"); await page.getByRole("button",{name:"Open board"}).click();
    const arrive=page.getByRole("button",{name:"Arrive patient 123 in Pod 1"});
    if(state==="open") {
      await page.screenshot({path:"test-results/incoming-arrival-pill-phone.png",fullPage:true});
      await arrive.click();
      await expect(arrive).toHaveCount(0);
      await expect(page.getByRole("button",{name:"Edit patient 123",exact:true})).toBeVisible();
      expect(moves).toBe(1);
      await expect(page.getByRole("dialog")).toHaveCount(0);
    } else {
      await expect(arrive).toBeDisabled();
      await expect(arrive).toHaveText(`Pod 1 ${state}`);
      expect(moves).toBe(0);
    }
  });
}

test("connected intake, assignment, edit, disposition and turnover use RPCs without local writes", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("tent-flow-dev-auth", JSON.stringify({ access_token: "test-token", refresh_token: "refresh", token_type: "bearer", expires_at: Math.floor(Date.now()/1000)+3600, user: { id: "test-user", email: "tester@example.com" } }));
    localStorage.setItem("tent-board-pods-v3", "demo-sentinel");
  });
  const snapshot: any = { pods: [{ id: "pod", name: "Pod 1", color: "#facc15", capabilities: [], closed: false, beds: [{id:"bed",label:"1-1",status:"open"},{id:"bed2",label:"1-2",status:"open"}] }], visits: [], placements: [], turnovers: [] };
  await page.route("**/rest/v1/rpc/my_races", route => route.fulfill({json:[{id:"race",name:"Test Race",role:"owner",state:"active"}]}));
  await page.route("**/rest/v1/rpc/patient_board", route => route.fulfill({json:snapshot}));
  const saves: any[]=[];
  await page.route("**/rest/v1/rpc/save_patient", async route => {
    const body=route.request().postDataJSON(); saves.push(body);
    const existing=snapshot.visits[0];
    if(existing) expect(body.p_revision).toBe(existing.revision);
    snapshot.visits=[{...existing,id:body.p_visit,...body.p_details,revision:(existing?.revision ?? 0)+1,dispositioned_at:null,medical_started_at:body.p_bed ? "2026-10-14T10:00:00Z" : null}];
    if(body.p_bed) { snapshot.placements=[{visit_id:body.p_visit,bed_id:"bed",ended_at:null,started_at:"2026-10-14T10:00:00Z",kind:"regular"}];snapshot.pods[0].beds[0].status="occupied"; }
    await route.fulfill({json:snapshot.visits[0].revision});
  });
  await page.route("**/rest/v1/rpc/move_patient", async route => {
    const body=route.request().postDataJSON();
    if(body.p_action === "assigned") {
      expect(body).toMatchObject({p_visit:snapshot.visits[0].id,p_revision:3,p_bed:"bed2"});
      snapshot.visits[0].revision=4;
      snapshot.placements[0].ended_at="2026-10-14T10:30:00Z";
      snapshot.placements.push({visit_id:body.p_visit,bed_id:"bed2",ended_at:null,started_at:"2026-10-14T10:30:00Z",kind:"regular"});
      snapshot.pods[0].beds[0].status="cleaning"; snapshot.pods[0].beds[1].status="occupied";
      snapshot.turnovers=[{id:"turnover",bed_id:"bed"}];
      await route.fulfill({json:4}); return;
    }
    expect(body).toMatchObject({p_visit:snapshot.visits[0].id,p_revision:4,p_action:"dispositioned",p_category:"other",p_other:"Test transport"});
    snapshot.visits[0].dispositioned_at="2026-10-14T11:00:00Z"; snapshot.visits[0].disposition="other"; snapshot.visits[0].other_disposition="Test transport";
    snapshot.placements[1].ended_at="2026-10-14T11:00:00Z"; snapshot.pods[0].beds[1].status="cleaning";
    snapshot.turnovers.push({id:"turnover2",bed_id:"bed2"});
    await route.fulfill({json:5});
  });
  await page.route("**/rest/v1/rpc/ready_patient_bed", async route => {
    expect(route.request().postDataJSON()).toEqual({p_bed:"bed",p_turnover:"turnover"}); snapshot.pods[0].beds[0].status="open";snapshot.turnovers=[]; await route.fulfill({json:null});
  });
  await page.goto("/"); await page.getByRole("button",{name:"Open board"}).click();
  await page.getByRole("button",{name:"New Patient",exact:true}).click();
  let modal=page.getByRole("dialog");
  await modal.getByLabel("Race #",{exact:true}).fill("TEST-1");
  await modal.getByLabel("Preassign Pod (Incoming)").selectOption("pod");
  await modal.getByRole("button",{name:"Add",exact:true}).click();
  await expect(modal).toHaveCount(0);
  expect(saves[0]).toMatchObject({p_revision:null,p_bed:null,p_details:{triage:"untriaged",complaint:"",planned_pod_id:"pod"}});
  expect(snapshot.visits[0].medical_started_at).toBeNull();
  expect(snapshot.placements).toHaveLength(0);
  await page.getByRole("button",{name:"New Patient",exact:true}).click();
  await modal.getByLabel("Race #",{exact:true}).fill("test-1");
  await modal.getByRole("button",{name:"Add",exact:true}).click();
  await expect(page.getByRole("heading",{name:"Patient already on board"})).toBeVisible();
  expect(saves).toHaveLength(1);
  await page.getByRole("button",{name:"Open existing patient",exact:true}).click();
  await expect(modal.getByLabel("Preassign Pod (Incoming)")).toHaveValue("pod");
  await modal.getByRole("button",{name:"Cancel",exact:true}).click();
  await page.getByRole("button",{name:/Incoming \(1\)/}).click();
  await page.getByRole("button",{name:"Edit patient TEST-1",exact:true}).click();
  await modal.getByLabel("Move to pod").selectOption("pod");
  await modal.getByRole("button",{name:"Save",exact:true}).click();
  await expect(modal).toHaveCount(0);
  await page.getByRole("button",{name:"Edit patient TEST-1",exact:true}).click();
  await modal.getByLabel("Notes",{exact:true}).fill("Test note");
  await modal.getByRole("button",{name:"Save",exact:true}).click();
  await expect(modal).toHaveCount(0);
  expect(saves[2]).toMatchObject({p_revision:2,p_bed:null,p_details:{notes:"Test note"}});
  // Wait for the closing modal overlay to stop intercepting pointer events.
  await page.getByRole("button",{name:"Edit patient TEST-1",exact:true}).click({trial:true});
  const source=await page.getByRole("button",{name:"Edit patient TEST-1",exact:true}).boundingBox();
  const target=await page.getByText("1-2",{exact:true}).boundingBox();
  await page.mouse.move(source!.x+source!.width/2,source!.y+source!.height/2);
  await page.mouse.down(); await page.waitForTimeout(550);
  await page.mouse.move(target!.x+target!.width/2,target!.y+target!.height/2,{steps:10}); await page.mouse.up();
  await expect.poll(()=>snapshot.visits[0].revision).toBe(4);
  await page.getByRole("combobox",{name:"Disposition patient TEST-1"}).selectOption("other");
  await modal.getByLabel("Other disposition description").fill("Test transport");
  await modal.getByRole("button",{name:"Confirm disposition"}).click();
  await page.getByRole("button",{name:/^Pod 1 /}).click();
  await modal.getByRole("button",{name:"1-1 ready"}).click();
  await expect(modal.getByRole("button",{name:"1-1 ready"})).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.screenshot({path:"test-results/connected-patient-board.png",fullPage:true});
  expect(await page.evaluate(()=>localStorage.getItem("tent-board-pods-v3"))).toBe("demo-sentinel");
});

test("a duplicate created on another device opens the refreshed existing patient", async ({page}) => {
  await page.addInitScript(()=>localStorage.setItem("tent-flow-dev-auth",JSON.stringify({access_token:"token",refresh_token:"refresh",token_type:"bearer",expires_at:Math.floor(Date.now()/1000)+3600,user:{id:"user"}})));
  const snapshot:any={pods:[],visits:[],placements:[],turnovers:[]};
  await page.route("**/rest/v1/rpc/my_races",route=>route.fulfill({json:[{id:"race",name:"Test",role:"editor",state:"active"}]}));
  await page.route("**/rest/v1/rpc/patient_board",route=>route.fulfill({json:snapshot}));
  await page.route("**/rest/v1/rpc/save_patient",async route=>{
    snapshot.visits=[{id:"existing",bib:"123",triage:"untriaged",complaint:"",revision:1,medical_started_at:null,dispositioned_at:null}];
    await route.fulfill({status:400,json:{code:"P0002",message:"An active patient already has this race number",details:"existing"}});
  });
  await page.goto("/"); await page.getByRole("button",{name:"Open board"}).click();
  await page.getByRole("button",{name:"New Patient",exact:true}).click();
  await page.getByLabel("Race #",{exact:true}).fill("123");
  await page.getByRole("button",{name:"Add",exact:true}).click();
  await expect(page.getByRole("heading",{name:"Patient already on board"})).toBeVisible();
  await page.getByRole("button",{name:"Open existing patient"}).click();
  await expect(page.getByRole("dialog").getByLabel("Race #",{exact:true})).toHaveValue("123");
  await expect(page.getByRole("button",{name:"Save",exact:true})).toBeEnabled();
});

test("unavailable patient endpoint fails closed without loading demo patients", async ({page}) => {
  await page.addInitScript(()=>localStorage.setItem("tent-flow-dev-auth",JSON.stringify({access_token:"token",refresh_token:"refresh",token_type:"bearer",expires_at:Math.floor(Date.now()/1000)+3600,user:{id:"user"}})));
  await page.route("**/rest/v1/rpc/my_races",route=>route.fulfill({json:[{id:"race",name:"Test",role:"editor",state:"active"}]}));
  await page.route("**/rest/v1/rpc/patient_board",route=>route.fulfill({status:403,json:{message:"Access denied"}}));
  await page.goto("/"); await page.getByRole("button",{name:"Open board"}).click();
  await expect(page.getByRole("alert")).toContainText("Unable to load patient records");
  await expect(page.getByRole("button",{name:"New Patient",exact:true})).toHaveCount(0);
});

test.beforeEach(async({page})=>{await page.route("**/rest/v1/rpc/available_races",r=>r.fulfill({json:[]}));});
