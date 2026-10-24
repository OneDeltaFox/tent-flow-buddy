import { expect, test, type Page } from "@playwright/test";
import { defaultComplaintOptions } from "../../src/lib/complaints";

for (const width of [320,390,1280]) test(`long race title wraps at ${width}px`,async ({page})=>{
  await page.setViewportSize({width,height:844});
  const name="Wine and Dine Half Marathon";
  await setup(page,"owner",name);
  const title=page.getByRole("heading",{name,exact:true});
  await expect(title).toBeVisible();
  expect(await title.evaluate(el=>el.scrollWidth<=el.clientWidth && el.scrollHeight<=el.clientHeight)).toBe(true);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:`test-results/race-title-${width}.png`,fullPage:true});
});

for (const [width,height] of [[390,844],[375,568],[844,390],[768,1024],[1280,844]] as const) test(`menu and complaint settings stay usable at ${width}px`, async ({page})=>{
  await page.setViewportSize({width,height});
  let options=defaultComplaintOptions();
  await page.route("**/rest/v1/rpc/race_complaints",route=>route.fulfill({json:options}));
  await page.route("**/rest/v1/rpc/save_race_complaints",route=>{
    expect(route.request().postDataJSON().p_expected).toEqual(options);
    options=route.request().postDataJSON().p_options;
    return route.fulfill({json:null});
  });
  await setup(page);
  await expect(page.getByRole("button",{name:"New Patient",exact:true})).toBeVisible();
  await page.getByRole("button",{name:"Menu",exact:true}).click();
  const dialog=page.getByRole("dialog");
  await expect(dialog.getByRole("button",{name:"Manage Chief Complaints"})).toBeEnabled();
  const bounds=await dialog.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x+bounds!.width).toBeLessThanOrEqual(width+1);
  expect(bounds!.y).toBeGreaterThanOrEqual(0);
  expect(bounds!.y+bounds!.height).toBeLessThanOrEqual(height+1);
  expect(await dialog.evaluate(el=>getComputedStyle(el).translate)).toBe("none");
  await page.screenshot({path:`test-results/board-menu-${width}.png`,fullPage:true});
  await dialog.getByRole("button",{name:"Manage Chief Complaints"}).click();
  await expect(dialog).toHaveCount(1);
  await dialog.getByLabel("New complaint",{exact:true}).fill("Test complaint");
  await dialog.getByRole("button",{name:"Add complaint",exact:true}).click();
  await dialog.getByRole("button",{name:"Review changes"}).click();
  await dialog.getByRole("button",{name:"Confirm changes"}).click();
  await expect(dialog).toHaveCount(0);
  expect(options.some(x=>x.label==="Test complaint")).toBe(true);
});

test("pod deletion requires confirmation and blocks occupied pods",async ({page})=>{
  const snapshot=await setup(page);
  let deleted=false;
  await page.route("**/rest/v1/rpc/delete_pod",route=>{
    expect(route.request().postDataJSON()).toMatchObject({p_pod:"p1",p_confirm:"Pod 1"});
    snapshot.pods.shift(); deleted=true;
    return route.fulfill({json:null});
  });
  await page.getByRole("button",{name:"Edit Pod 2",exact:true}).click();
  await expect(page.getByRole("button",{name:"Delete Pod",exact:true})).toBeDisabled();
  await page.getByRole("dialog").getByRole("button",{name:"Cancel",exact:true}).click();
  await page.getByRole("button",{name:"Edit Pod 1",exact:true}).click();
  await page.getByRole("button",{name:"Delete Pod",exact:true}).click();
  await expect(page.getByRole("button",{name:"Confirm Delete Pod"})).toBeDisabled();
  expect(deleted).toBe(false);
  await page.getByLabel("Type Pod 1 to confirm").fill("Pod 1");
  await page.getByRole("button",{name:"Confirm Delete Pod"}).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("button",{name:"Edit Pod 1",exact:true})).toHaveCount(0);
  expect(deleted).toBe(true);
});

async function setup(page: Page, role = "owner", name = "Test Race") {
  await page.addInitScript(() => localStorage.setItem("tent-flow-dev-auth", JSON.stringify({ access_token:"token", refresh_token:"refresh", token_type:"bearer", expires_at:Math.floor(Date.now()/1000)+3600, user:{id:"owner"} })));
  const snapshot = {
    pods: [
      { id:"p1", name:"Pod 1", color:"#ff8800", kind:"regular", closed:false, capabilities:["Cooling"], beds:[{id:"b1",label:"1-1",status:"open"}] },
      { id:"p2", name:"Pod 2", color:"#ffff00", kind:"regular", closed:false, capabilities:[], beds:[{id:"b2",label:"2-1",status:"occupied"}] },
    ],
    visits:[{id:"v1",revision:1,bib:"TEST-1",triage:"untriaged",complaint:"Dizziness",notes:"",source:"",eta:"",medical_started_at:"2026-10-14T10:00:00Z",dispositioned_at:null}],
    placements:[{visit_id:"v1",bed_id:"b2",started_at:"2026-10-14T10:00:00Z",ended_at:null,kind:"regular"}], turnovers:[], reservations: [] as {visit_id:string;bed_id:string}[],
  };
  await page.route("**/rest/v1/rpc/my_races", route=>route.fulfill({json:[{id:"race",name,state:"active",role}]}));
  await page.route("**/rest/v1/rpc/patient_board",route=>route.fulfill({json:snapshot}));
  await page.goto("/"); await page.getByRole("button",{name:"Open board",exact:true}).click();
  return snapshot;
}

test("pool capacity is separate on both boards and stays in census", async ({page})=>{
  const snapshot = await setup(page);
  snapshot.pods[1]!.kind = "pool";
  snapshot.pods.push({id:"p3",name:"Pool 2",color:"#ffff00",kind:"pool",closed:false,capabilities:[],beds:[{id:"b3",label:"Pool 2-1",status:"open"}]});
  snapshot.pods.push({id:"p4",name:"Pool 3",color:"#ffff00",kind:"pool",closed:true,capabilities:[],beds:[{id:"b4",label:"Pool 3-1",status:"open"}]});
  await page.getByRole("button",{name:"Menu",exact:true}).click();
  await page.getByRole("button",{name:"Refresh board"}).click();
  const stat = (label: string) => page.getByText(label,{exact:true}).locator("..");
  await expect(stat("Current census")).toContainText("1");
  await expect(stat("Occupied beds")).toContainText("0");
  await expect(stat("Open beds")).toContainText("1 / 1");
  await expect(stat("Occupied pools")).toContainText("1");
  await expect(stat("Open pools")).toContainText("1 / 2");
  await page.getByRole("button",{name:"Menu",exact:true}).click();
  await page.getByRole("button",{name:"Status Board",exact:true}).click();
  await expect(stat("Census")).toContainText("1");
  await expect(page.getByRole("region",{name:"Beds",exact:true}).getByText("Capacity",{exact:true}).locator("..")).toContainText("1");
  await expect(page.getByRole("region",{name:"Beds",exact:true})).toContainText("0%");
  await expect(page.getByRole("region",{name:"Pools",exact:true})).toContainText("1 / 2");
});

test("reserved bed displays In pool, counts once and returns to its exact bed", async ({page})=>{
  const snapshot = await setup(page);
  snapshot.pods[0]!.beds[0]!.status = "occupied";
  snapshot.pods[1]!.kind = "pool";
  snapshot.placements[0]!.kind = "pool";
  snapshot.reservations = [{visit_id:"v1",bed_id:"b1"}];
  await page.getByRole("button",{name:"Menu",exact:true}).click();
  await page.getByRole("button",{name:"Refresh board"}).click();
  const stat = (label:string) => page.getByText(label,{exact:true}).locator("..");
  await expect(stat("Current census")).toContainText("1");
  await expect(stat("Occupied beds")).toContainText("1");
  await expect(stat("Open beds")).toContainText("0 / 1");
  await expect(page.getByText("In pool",{exact:true})).toBeVisible();
  await page.getByRole("button",{name:"Menu",exact:true}).click();
  await page.getByRole("button",{name:"Status Board",exact:true}).click();
  await expect(stat("Census")).toContainText("1");
  await expect(page.getByRole("region",{name:"Beds",exact:true})).toContainText("100%");
  await expect(page.getByText("In pool",{exact:true})).toBeVisible();
  await page.screenshot({path:"test-results/pool-reservation-status.png",fullPage:true});
  await page.getByRole("button",{name:"Back to working board"}).click();
  await page.getByRole("button",{name:"Edit patient TEST-1",exact:true}).filter({hasText:"In pool"}).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Move to pod")).toHaveValue("p2");
  await dialog.getByLabel("Move to pod").selectOption("p1");
  let saved = false;
  await page.route("**/rest/v1/rpc/save_patient", async route => {
    expect(route.request().postDataJSON()).toMatchObject({p_visit:"v1",p_revision:1,p_bed:"b1"});
    snapshot.reservations=[]; snapshot.placements[0]!.bed_id="b1"; snapshot.placements[0]!.kind="regular";
    snapshot.pods[1]!.beds[0]!.status="cleaning"; saved=true;
    await route.fulfill({json:2});
  });
  await dialog.getByRole("button",{name:"Save",exact:true}).click();
  await expect(dialog).toHaveCount(0);
  expect(saved).toBe(true);
  await expect(page.getByText("In pool",{exact:true})).toHaveCount(0);
});

for (const width of [390,1280]) test(`owner can confirm pod edits at ${width}px`, async ({page})=>{
  await page.setViewportSize({width,height:844});
  const snapshot=await setup(page);
  let saves=0;
  await page.route("**/rest/v1/rpc/edit_pod_settings",async route=>{
    const body=route.request().postDataJSON();
    expect(body.p_expected).toEqual({name:"Pod 1",color:snapshot.pods[0]!.color,kind:"regular",beds:1,closed:snapshot.pods[0]!.closed,capabilities:snapshot.pods[0]!.capabilities});
    expect(body.p_color).toBe("#ffff00");
    snapshot.pods[0]!.color=body.p_color;
    expect(body.p_pod).toBe("p1");
    snapshot.pods[0]!.closed=body.p_closed; snapshot.pods[0]!.capabilities=body.p_capabilities; saves++;
    await route.fulfill({json:null});
  });
  await page.getByRole("button",{name:"Edit Pod 1",exact:true}).click();
  const dialog=page.getByRole("dialog");
  await dialog.getByLabel("Pod color",{exact:true}).fill("#ffff00");
  await page.screenshot({path:`test-results/full-pod-editor-${width}.png`,fullPage:true});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await dialog.getByRole("button",{name:"Remove Cooling",exact:true}).click();
  await dialog.getByLabel("Capability",{exact:true}).fill("IV");
  await dialog.getByRole("button",{name:"Add capability",exact:true}).click();
  await dialog.getByLabel("Closed to new assignments").check();
  await dialog.getByRole("button",{name:"Review changes"}).click();
  expect(saves).toBe(0);
  await expect(dialog).toContainText("Remove: Cooling");
  await dialog.getByRole("button",{name:"Confirm changes"}).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("button",{name:"Pod 1 Closed",exact:true})).toBeVisible();
  expect(snapshot.pods[0]!.capabilities).toEqual(["IV"]);
  await page.getByRole("button",{name:"Edit Pod 1",exact:true}).click();
  await dialog.getByLabel("Closed to new assignments").uncheck();
  await dialog.getByRole("button",{name:"Review changes"}).click();
  await dialog.getByRole("button",{name:"Confirm changes"}).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("button",{name:/Pod 1 0\/1/})).toBeVisible();
  expect(saves).toBe(2);
});

test("section preview requires confirmation and refreshes a stale plan", async ({page})=>{
  const snapshot=await setup(page);
  let previews=0, additions=0;
  await page.route("**/rest/v1/rpc/preview_section_pods",async route=>{
    expect(route.request().postDataJSON()).toEqual({p_race:"race",p_color:"#ff8800",p_count:1,p_beds:4});
    previews++;
    await route.fulfill({json:{token:`token-${previews}`,new_names:["Pod 2"],color:"#ff8800",beds_per_pod:4,changes:[{id:"p2",from:"Pod 2",to:"Pod 3",beds:[{id:"b2",from:"2-1",to:"3-1"}]}]}});
  });
  await page.route("**/rest/v1/rpc/add_section_pods",async route=>{
    const body=route.request().postDataJSON();
    expect(body.p_expected_token).toBe(`token-${previews}`);
    expect(body.p_color).toBe("#ff8800"); additions++;
    if(additions===1) { await route.fulfill({status:409,json:{code:"40001",message:"Layout changed"}}); return; }
    snapshot.pods[1]!.name="Pod 3"; snapshot.pods[1]!.beds[0]!.label="3-1";
    snapshot.pods.push({id:"p3",name:"Pod 2",color:"#ff8800",kind:"regular",closed:false,capabilities:[],beds:[{id:"b3",label:"2-1",status:"open"}]});
    await route.fulfill({json:1});
  });
  await page.getByText("Menu",{exact:true}).click();
  await page.getByRole("button",{name:"Add pods",exact:true}).click();
  const dialog=page.getByRole("dialog");
  await dialog.getByLabel("Color section").selectOption("#ff8800");
  await expect(dialog.getByLabel("Starting number")).toHaveCount(0);
  await dialog.getByRole("button",{name:"Preview changes"}).click();
  await expect(dialog).toContainText("Pod 2 → Pod 3");
  expect(additions).toBe(0);
  await page.setViewportSize({width:375,height:812});
  await expect(dialog).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:"test-results/section-confirmation-phone.png",fullPage:true});
  await dialog.getByRole("button",{name:"Confirm addition"}).click();
  await expect(dialog.getByRole("alert")).toContainText("layout changed");
  await dialog.getByRole("button",{name:"Preview changes"}).click();
  await dialog.getByRole("button",{name:"Confirm addition"}).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("button",{name:"Edit patient TEST-1",exact:true})).toBeVisible();
  expect(snapshot.placements[0]!.bed_id).toBe("b2");
});

test("editors do not receive pod administration controls",async({page})=>{
  await setup(page,"editor");
  await expect(page.getByRole("button",{name:"New Patient",exact:true})).toBeVisible();
  await expect(page.getByRole("button",{name:"Edit Pod 1",exact:true})).toHaveCount(0);
  await page.getByRole("button",{name:"Menu",exact:true}).click();
  await expect(page.getByRole("button",{name:"Manage Team",exact:true})).toHaveCount(0);
});
