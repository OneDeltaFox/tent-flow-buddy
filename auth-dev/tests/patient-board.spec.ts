import { expect, test } from "@playwright/test";

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
  await modal.getByRole("button",{name:"Add",exact:true}).click();
  await expect(modal).toHaveCount(0);
  expect(saves[0]).toMatchObject({p_revision:null,p_bed:null,p_details:{triage:"untriaged",complaint:""}});
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

test("unavailable patient endpoint fails closed without loading demo patients", async ({page}) => {
  await page.addInitScript(()=>localStorage.setItem("tent-flow-dev-auth",JSON.stringify({access_token:"token",refresh_token:"refresh",token_type:"bearer",expires_at:Math.floor(Date.now()/1000)+3600,user:{id:"user"}})));
  await page.route("**/rest/v1/rpc/my_races",route=>route.fulfill({json:[{id:"race",name:"Test",role:"editor",state:"active"}]}));
  await page.route("**/rest/v1/rpc/patient_board",route=>route.fulfill({status:403,json:{message:"Access denied"}}));
  await page.goto("/"); await page.getByRole("button",{name:"Open board"}).click();
  await expect(page.getByRole("alert")).toContainText("Unable to load patient records");
  await expect(page.getByRole("button",{name:"New Patient",exact:true})).toHaveCount(0);
});
