import assert from 'node:assert/strict';
import { mkdir,writeFile,readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const snapshot=path.resolve(process.argv[2]),evidence=path.resolve(process.argv[3]);
process.chdir(snapshot);await mkdir(evidence,{recursive:false});
const {LocalStore,sha256,createPlanArtifactEventPayload}=await import(pathToFileURL(path.join(snapshot,'packages/runtime/dist/index.js')));
const {createWebUiE2eRoot,startProductionWebServer,startWebUiBrowser,productionEntryReceipt}=await import(pathToFileURL(path.join(snapshot,'scripts/web-ui-e2e-runtime.mjs')));
const root=await createWebUiE2eRoot();
const receipt={kind:'napier.artifact-consumer-browser',snapshot,root,startedAt:new Date().toISOString(),paidModelCalls:0,themeBoundary:'Supported light theme only',cases:[],screenshots:[],consoleErrors:[],pageErrors:[],perturbations:[]};
const store=new LocalStore({dataRoot:path.join(root,'state'),workspaceRoot:path.join(root,'workspace')});
let server,browserRuntime,error,closed=false;
const fixtures={};
try{
 await store.initialize();const agent=store.listAgents()[0];assert(agent);
 await store.createCredentialReference({providerId:'openai',label:'Local fixture only',source:{type:'environment',variable:'NAPIER_E2E_MODEL_KEY'}});
 for(const name of ['match','missing']){
  const thread=await store.createThread({title:`G01 consumer ${name}`,agentId:agent.id});
  const run=await store.createRun({threadId:thread.id,agentId:agent.id,model:{provider:'faux-browser',id:'fixture'}});
  await store.appendEvent({threadId:thread.id,runId:run.id,type:'message.user',category:'message',visibility:'user',payload:{role:'user',text:'Inspect the delivered artifact and its current bytes.'}});
  const filename=name==='match'?'delivery.html':'missing.txt';
  const bytes=name==='match'?'<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Delivery fixture</title><body style="font-family:system-ui;padding:24px"><h1>Current delivery</h1><p>Exact selected artifact bytes.</p></body></html>':'Recorded but absent file\n';
  if(name==='match')await writeFile(path.join(root,'workspace',filename),bytes);
  let plan=await store.createPlan(thread.id,{objective:'Deliver the selected version',steps:[{id:'deliver',title:'Deliver',description:'Write artifact',verification:'Check current bytes'}],artifacts:[{id:'report',path:filename,description:'Inspect the artifact version and current integrity'}]});
  plan=await store.updatePlanArtifact(plan.id,'report',{status:'produced',sourceRunId:run.id,evidence:'Produced declaration'});
  await store.appendEvent({threadId:thread.id,runId:run.id,type:'plan.artifact.produced',category:'plan',visibility:'user',payload:createPlanArtifactEventPayload(plan,plan.artifacts[0])});
  plan=await store.updatePlanArtifact(plan.id,'report',{status:'verified',sourceRunId:run.id,evidence:'Historical integrity declaration',sha256:sha256(bytes),sizeBytes:Buffer.byteLength(bytes)});
  await store.appendEvent({threadId:thread.id,runId:run.id,type:'plan.artifact.verified',category:'plan',visibility:'user',payload:createPlanArtifactEventPayload(plan,plan.artifacts[0])});
  await store.finishRun(run.id,'completed');fixtures[name]={threadId:thread.id,planId:plan.id,filename,revision:plan.revision};
 }
 await store.shutdown();closed=true;
 receipt.fixtures=fixtures;receipt.productionEntry=await productionEntryReceipt();
 server=await startProductionWebServer(root);receipt.server={origin:server.origin,...server.receipt};browserRuntime=await startWebUiBrowser(root);receipt.browser=browserRuntime.receipt;
 for(const s of [
  {name:'current-en-desktop',fixture:'match',locale:'en',width:1440,height:1000},
  {name:'current-en-320',fixture:'match',locale:'en',width:320,height:1000},
  {name:'current-zh-390',fixture:'match',locale:'zh',width:390,height:1000},
  {name:'historical-en-desktop',fixture:'match',locale:'en',width:1440,height:1000,historical:true},
  {name:'missing-zh-320',fixture:'missing',locale:'zh',width:320,height:1000},
  {name:'mismatch-en-desktop',fixture:'match',locale:'en',width:1440,height:1000,mismatch:true},
  {name:'mismatch-zh-390',fixture:'match',locale:'zh',width:390,height:1000,mismatch:true},
 ]){
  const f=fixtures[s.fixture],context=await browserRuntime.browser.newContext({viewport:{width:s.width,height:s.height},colorScheme:'light'});
  await context.addInitScript(locale=>localStorage.setItem('napier.locale',locale),s.locale);
  const page=await context.newPage();
  page.on('pageerror',e=>receipt.pageErrors.push({scenario:s.name,message:e.message}));
  page.on('console',m=>{if(m.type()==='error')receipt.consoleErrors.push({scenario:s.name,message:m.text()});});
  if(s.historical)await page.route('**/api/**',async route=>{const u=new URL(route.request().url());if(!u.pathname.endsWith('/bootstrap')&&!u.pathname.endsWith('/threads/'+f.threadId))return route.continue();const response=await route.fetch();const body=await response.json(),detail=body.activeThread??body;let changed=0;for(const d of detail.taskNarrative?.deliverables??[]){delete d.observation;d.verification='integrity_recorded';d.accessibility='unchecked';changed++;}receipt.perturbations.push({scenario:s.name,kind:'omit-current-workspace-observation',url:route.request().url(),changed});await route.fulfill({response,json:body});});
  if(s.mismatch)await page.route(/\/artifacts\/report\/(peek|preview)$/,async route=>{const response=await route.fetch();const body=await response.json();body.planRevision++;receipt.perturbations.push({scenario:s.name,kind:'later-revision-receipt',url:route.request().url(),revision:body.planRevision});await route.fulfill({response,json:body});});
  await page.goto(`${server.origin}/?thread=${f.threadId}`,{waitUntil:'domcontentloaded',timeout:30000});
  const card=page.locator(`.conversation-artifact[data-artifact-path="${f.filename}"]`);await card.waitFor({timeout:30000});
  const fact=s.fixture==='missing'?'missing':s.historical?'unchecked':'integrity_observed';
  assert.equal(await card.getAttribute('data-artifact-current-fact'),fact);
  const header=await card.locator(':scope > header').innerText();
  if(s.historical)assert.match(header,/Integrity recorded/i);
  if(s.fixture==='match'){
   if(s.mismatch){await card.locator('.artifact-inline-preview header small').filter({hasText:s.locale==='zh'?'暂时无法预览':'Preview unavailable'}).waitFor({timeout:10000});assert.equal(await card.locator('iframe').count(),0);}
   else {await card.locator('iframe').waitFor({timeout:10000});await card.frameLocator('iframe').getByRole('heading',{name:'Current delivery'}).waitFor({timeout:10000});}
   const button=card.getByRole('button',{name:s.locale==='zh'?'预览':'Preview',exact:true});
   await button.focus();await page.keyboard.press('Enter');
   if(s.mismatch){const alert=card.getByRole('alert');await alert.waitFor();assert.match(await alert.innerText(),s.locale==='zh'?/另一个产物版本/:/different artifact version/);assert.equal(await page.locator('.artifact-inspector').count(),0);}
   else{const inspector=page.locator('.artifact-inspector');await inspector.waitFor();await inspector.locator('iframe').waitFor();assert.equal(await inspector.getByRole('button',{name:s.locale==='zh'?'关闭预览':'Close preview',exact:true}).evaluate(el=>document.activeElement===el),true);const controls=await inspector.locator('header button, header a').evaluateAll(nodes=>nodes.map(el=>{const r=el.getBoundingClientRect(),hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return {label:el.getAttribute('aria-label')||el.textContent,left:r.left,right:r.right,clickable:hit===el||el.contains(hit)};}));assert(controls.every(c=>c.left>=-1&&c.right<=s.width+1&&c.clickable),JSON.stringify(controls));receipt.inspectorControls??=[];receipt.inspectorControls.push({scenario:s.name,controls});const shot=path.join(evidence,s.name+'-inspector.png');await page.screenshot({path:shot,fullPage:true});receipt.screenshots.push(shot);await page.keyboard.press('Escape');await inspector.waitFor({state:'detached'});await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));const focus=await page.evaluate(()=>({tag:document.activeElement?.tagName,id:document.activeElement?.id,label:document.activeElement?.getAttribute('aria-label'),className:document.activeElement?.className,inactive:!!document.activeElement?.closest('[hidden],[inert]')}));receipt.focusRestoration??=[];receipt.focusRestoration.push({scenario:s.name,...focus});assert(!focus.inactive && ['BUTTON','INPUT','TEXTAREA'].includes(focus.tag),JSON.stringify(focus));}
  }
  await card.scrollIntoViewIfNeeded();
  const geometry=await card.evaluate(el=>{const violations=[],r=el.getBoundingClientRect();for(const node of el.querySelectorAll('header strong, header span, button, dl dd')){const b=node.getBoundingClientRect();if(b.left< -1||b.right>innerWidth+1)violations.push({text:node.textContent,kind:'outside-viewport',left:b.left,right:b.right});if(node.scrollWidth>node.clientWidth+1)violations.push({text:node.textContent,kind:'content-overflow'});}return {viewport:innerWidth,documentWidth:document.documentElement.scrollWidth,card:{left:r.left,right:r.right,width:r.width},violations};});
  const shot=path.join(evidence,s.name+'.png');await page.screenshot({path:shot,fullPage:true});receipt.screenshots.push(shot);
  assert.deepEqual(geometry.violations,[]);assert(geometry.documentWidth<=s.width+1);
  await page.locator('#workspace-view-task').click();await page.locator('#task-section-changes').click();
  const taskCard=page.locator(`.task-artifact-card[data-artifact-path="${f.filename}"]`);await taskCard.waitFor();const taskLabel=await taskCard.locator('.task-status-badge').innerText();
  if(s.historical)assert.match(taskLabel,/Integrity recorded/i);
  if(s.fixture==='missing')assert.match(taskLabel,/缺失|不存在|不可用/);
  receipt.cases.push({...s,fact,header,taskLabel,geometry,keyboardInspection:s.fixture==='match',versionMismatchRejected:!!s.mismatch});
  await context.close();
 }
 assert.equal(receipt.pageErrors.length,0,JSON.stringify(receipt.pageErrors));assert.equal(receipt.consoleErrors.length,0,JSON.stringify(receipt.consoleErrors));receipt.status='passed';
}catch(e){error=e;receipt.status='failed';receipt.error={message:e.message,stack:e.stack};}
finally{try{await browserRuntime?.close();receipt.browserClosed=true;}catch(e){receipt.browserCloseError=e.message;}try{await server?.close();receipt.serverClosed=true;}catch(e){receipt.serverCloseError=e.message;}if(!closed)await store.shutdown().catch(()=>{});receipt.finishedAt=new Date().toISOString();await writeFile(path.join(evidence,'receipt.json'),JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt,null,2));}
if(error)process.exitCode=1;
