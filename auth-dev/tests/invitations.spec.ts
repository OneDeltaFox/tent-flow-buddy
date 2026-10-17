import { test, expect } from "@playwright/test";

test("owner creates and cancels an invitation with confirmation on mobile", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("tent-flow-dev-auth", JSON.stringify({ access_token:"token",refresh_token:"refresh",token_type:"bearer",expires_at:Math.floor(Date.now()/1000)+3600,user:{id:"owner"} })));
  await page.route("**/rest/v1/rpc/my_races",r=>r.fulfill({json:[{id:"race",name:"Invite Test",role:"owner",state:"active"}]}));
  await page.route("**/rest/v1/rpc/my_race_invitations",r=>r.fulfill({json:[]}));
  await page.route("**/rest/v1/rpc/patient_board",r=>r.fulfill({json:{pods:[],visits:[],placements:[],turnovers:[]}}));
  await page.route("**/rest/v1/rpc/race_team",r=>r.fulfill({json:[{id:"owner",email:"owner@example.test",role:"owner"}]}));
  let invites: any[]=[]; let writes=0;
  await page.route("**/rest/v1/rpc/race_invitations",r=>r.fulfill({json:invites}));
  await page.route("**/rest/v1/rpc/create_race_invitation",async r=>{
    writes++; expect(r.request().postDataJSON()).toMatchObject({p_email:"new@example.test",p_role:"editor",p_race:"race"});
    invites=[{id:"invite",email:"new@example.test",role:"editor",expires_at:"2099-01-01T00:00:00Z"}]; await r.fulfill({json:"invite"});
  });
  await page.route("**/rest/v1/rpc/cancel_race_invitation",async r=>{ writes++; invites=[]; await r.fulfill({status:204}); });
  await page.goto("/"); await page.getByRole("button",{name:"Open board"}).click();
  await page.getByText("Race Settings",{exact:true}).click(); await page.getByRole("button",{name:"Manage Team",exact:true}).click();
  await page.getByLabel("Invitation email",{exact:true}).fill("new@example.test");
  await page.getByRole("combobox",{name:"Invitation role",exact:true}).selectOption("editor");
  await page.getByRole("button",{name:"Create invitation",exact:true}).click();
  expect(writes).toBe(0); await expect(page.getByText(/No email will be sent/)).toBeVisible();
  await page.getByRole("button",{name:"Confirm invitation"}).click();
  await expect(page.getByText("new@example.test",{exact:true})).toBeVisible();
  await page.setViewportSize({width:375,height:812});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:"test-results/invitations-phone.png",fullPage:true});
  await page.getByRole("button",{name:"Cancel invitation for new@example.test"}).click();
  expect(writes).toBe(1); await page.getByRole("button",{name:"Confirm invitation"}).click();
  await expect(page.getByText("No pending invitations.")).toBeVisible(); expect(writes).toBe(2);
});

test("recipient accepts explicitly and uncertain requests require refresh", async ({page})=>{
  await page.addInitScript(()=>localStorage.setItem("tent-flow-dev-auth",JSON.stringify({access_token:"token",refresh_token:"refresh",token_type:"bearer",expires_at:Math.floor(Date.now()/1000)+3600,user:{id:"recipient"}})));
  let accepted=false; let fail=true;
  await page.route("**/rest/v1/rpc/my_races",r=>r.fulfill({json:accepted?[{id:"race",name:"Invited Race",role:"viewer",state:"active"}]:[]}));
  await page.route("**/rest/v1/rpc/my_race_invitations",r=>r.fulfill({json:accepted?[]:[{id:"invite",name:"Invited Race",role:"viewer",expires_at:"2099-01-01T00:00:00Z"}]}));
  await page.route("**/rest/v1/rpc/accept_race_invitation",async r=>{if(fail) return r.fulfill({status:409,json:{message:"Expired"}}); accepted=true; await r.fulfill({status:204});});
  await page.goto("/"); await page.getByRole("button",{name:"Accept",exact:true}).click();
  await page.getByRole("button",{name:"Confirm invitation"}).click();
  await expect(page.getByRole("button",{name:"Confirm invitation"})).toBeDisabled();
  await page.getByRole("button",{name:"Refresh invitations"}).click(); fail=false;
  await page.getByRole("button",{name:"Accept",exact:true}).click(); await page.getByRole("button",{name:"Confirm invitation"}).click();
  await expect(page.getByRole("button",{name:"Open board"})).toBeVisible();
});
