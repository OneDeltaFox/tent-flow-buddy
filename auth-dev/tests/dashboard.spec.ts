import { test, expect } from "@playwright/test";

for (const width of [390,1280]) test(`dashboard menus and layout ${width}`,async({page})=>{
  await page.setViewportSize({width,height:900});
  await page.addInitScript(()=>localStorage.setItem("tent-flow-dev-auth",JSON.stringify({access_token:"token",refresh_token:"refresh",token_type:"bearer",expires_at:Math.floor(Date.now()/1000)+3600,user:{id:"owner",email:"owner@example.com"}})));
  await page.route("**/rest/v1/rpc/my_races",r=>r.fulfill({json:[
    {id:"one",name:"Friday 5K",state:"active",role:"owner",timezone:"America/New_York"},
    {id:"two",name:"Saturday 10K",state:"closed",role:"owner",timezone:"America/New_York"}
  ]}));
  await page.route("**/rest/v1/rpc/my_race_invitations",r=>r.fulfill({json:[]}));
  await page.goto("/");
  await expect(page.getByRole("heading",{name:"Friday 5K"})).toBeVisible();
  await expect(page.getByText("Development",{exact:true})).toHaveCount(0);
  await page.screenshot({path:`test-results/dashboard-${width}.png`,fullPage:true});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.getByRole("button",{name:"Race options for Saturday 10K"}).click();
  await expect(page.getByRole("menuitem",{name:"Archive Race"})).toBeVisible();
  await page.getByRole("menuitem",{name:"Rename Race"}).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button",{name:"Cancel",exact:true}).click();
  await page.getByRole("button",{name:"Account menu"}).click();
  await expect(page.getByRole("menuitem",{name:"Sign out"})).toBeVisible();
  await page.getByRole("menuitem",{name:"Set or change password"}).click();
  await expect(page.getByLabel("New password",{exact:true})).toBeVisible();
});

test("sign-in preview",async({page})=>{
  await page.setViewportSize({width:1280,height:900});
  await page.goto("/");
  await expect(page.getByRole("button",{name:"Sign in",exact:true})).toBeVisible();
  await page.screenshot({path:"test-results/sign-in-polished.png",fullPage:true});
});
