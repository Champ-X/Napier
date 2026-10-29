import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const snapshot=path.resolve(process.argv[2]);
const evidence=path.resolve(process.argv[3]);
process.chdir(snapshot);
await mkdir(evidence,{recursive:false});
const {LocalStore,sha256,createPlanArtifactEventPayload}=await import(pathToFileURL(path.join(snapshot,'packages/runtime/dist/index.js')));
const {createWebUiE2eRoot,startProductionWebServer,startWebUiBrowser,productionEntryReceipt}=await import(pathToFileURL(path.join(snapshot,'scripts/web-ui-e2e-runtime.mjs')));
const root=await createWebUiE2eRoot();
const receipt={kind:'napier.task-artifact-facts-browser',schemaVersion:1,snapshot,root,startedAt:new Date().toISOString(),paidModelCalls:0,themeBoundary:'Product supports light only; no dark theme acceptance',cases:[],screenshots:[],consoleErrors:[],pageErrors:[],failedRequests:[]};
const store=new LocalStore({dataRoot:path.join(root,'state'),workspaceRoot:path.join(root,'workspace')});
const fixtures={};
let server,browserRuntime,operationError,storeClosed=false;
try {
 await store.initialize();
 const agent=store.listAgents()[0];assert(agent);
 await store.createCredentialReference({providerId:'openai',label:'Local browser fixture only',source:{type:'environment',variable:'NAPIER_E2E_MODEL_KEY'}});
 for(const name of ['match','missing','reappeared']){
  const thread=await store.createThread({title:`G01 ${name} artifact observation`,agentId:agent.id});
  const run=await store.createRun({threadId:thread.id,agentId:agent.id,model:{provider:'faux-g01-browser',id:'fixture'}});
  await store.appendEvent({threadId:thread.id,runId:run.id,type:'message.user',category:'message',visibility:'user',payload:{role:'user',text:'Review the current artifact bytes.'}});
  let plan=await store.createPlan(thread.id,{objective:'Deliver an artifact with current integrity evidence',steps:[{id:'inspect',title:'Inspect artifact',description:'Review current file bytes',verification:'The bytes match the declared digest'}],artifacts:[{id:'report',path:`${name}.txt`,description:'Current artifact fixture'}]});
  const versions=name==='match'?['old observed version\n','current observed version\n']:['declared but missing\n'];
  for(const bytes of versions){
   if(name==='match')await writeFile(path.join(root,'workspace',`${name}.txt`),bytes);
   const priorRevision=plan.revision;
   plan=await store.updatePlanArtifact(plan.id,'report',{status:'produced',sourceRunId:run.id,evidence:'Declared artifact version'});
   if(plan.revision!==priorRevision)await store.appendEvent({threadId:thread.id,runId:run.id,type:`plan.artifact.${plan.artifacts[0].status}`,category:'plan',visibility:'user',payload:createPlanArtifactEventPayload(plan,plan.artifacts[0])});
   plan=await store.updatePlanArtifact(plan.id,'report',{status:'verified',sha256:sha256(bytes),sizeBytes:Buffer.byteLength(bytes),sourceRunId:run.id,evidence:'Caller declared verification metadata'});
   await store.appendEvent({threadId:thread.id,runId:run.id,type:'plan.artifact.verified',category:'plan',visibility:'user',payload:createPlanArtifactEventPayload(plan,plan.artifacts[0])});
  }
  if(name==='reappeared'){
   plan=await store.updatePlanArtifact(plan.id,'report',{status:'missing',sourceRunId:run.id,evidence:'Caller declared file missing'});
   await store.appendEvent({threadId:thread.id,runId:run.id,type:'plan.artifact.missing',category:'plan',visibility:'user',payload:createPlanArtifactEventPayload(plan,plan.artifacts[0])});
  }
  await store.finishRun(run.id,'completed');
  fixtures[name]={threadId:thread.id,runId:run.id,planId:plan.id};
 }
 await store.shutdown();storeClosed=true;
 receipt.fixtures=fixtures; receipt.productionEntry=await productionEntryReceipt();
 server=await startProductionWebServer(root);receipt.server={origin:server.origin,...server.receipt};
 browserRuntime=await startWebUiBrowser(root);receipt.browser=browserRuntime.receipt;
 for(const scenario of [
  {name:'match-en-desktop',fixture:'match',locale:'en',width:1440,height:1000,status:'passed'},
  {name:'missing-en-desktop',fixture:'missing',locale:'en',width:1440,height:1000,status:'failed'},
  {name:'drift-zh-narrow',fixture:'match',locale:'zh',width:390,height:900,status:'failed',drift:true},
  {name:'missing-zh-320',fixture:'missing',locale:'zh',width:320,height:900,status:'failed'},
  {name:'reappeared-en-desktop',fixture:'reappeared',locale:'en',width:1440,height:1000,status:'unknown',reappear:true},
 ]){
  if(scenario.reappear)await writeFile(path.join(root,'workspace','reappeared.txt'),'file has returned without a new ledger event\n');
  if(scenario.drift)await writeFile(path.join(root,'workspace','match.txt'),'current bytes were changed after verification\n');
  const context=await browserRuntime.browser.newContext({viewport:{width:scenario.width,height:scenario.height},colorScheme:'light'});
  await context.addInitScript(locale=>localStorage.setItem('napier.locale',locale),scenario.locale);
  const page=await context.newPage();
  page.on('pageerror',e=>receipt.pageErrors.push({scenario:scenario.name,message:e.message}));
  page.on('console',m=>{if(m.type()==='error')receipt.consoleErrors.push({scenario:scenario.name,message:m.text()});});
  page.on('requestfailed',r=>receipt.failedRequests.push({scenario:scenario.name,url:r.url(),failure:r.failure()}));
  await page.goto(`${server.origin}/?thread=${encodeURIComponent(fixtures[scenario.fixture].threadId)}`,{waitUntil:'domcontentloaded',timeout:30000});
  await page.locator('#workspace-view-task').click({timeout:30000});
  await page.locator('#task-section-overview').focus();
  await page.keyboard.press('End');
  await page.locator('#task-section-validation[aria-selected="true"]').waitFor({timeout:30000});
  assert.equal(await page.locator('#task-section-validation').evaluate(el=>document.activeElement===el),true);
  const artifact=page.locator('.task-validation-row').last();
  await artifact.locator(`.task-status-badge.is-${scenario.status}`).waitFor({timeout:10000});
  const before=await artifact.innerText();
  const geometry=await page.evaluate(()=>({viewport:innerWidth,documentWidth:document.documentElement.scrollWidth,bodyWidth:document.body.scrollWidth,panelWidth:document.querySelector('.task-validation')?.getBoundingClientRect().width,colorScheme:getComputedStyle(document.documentElement).colorScheme,focusedId:document.activeElement?.id,tableRoles:[...document.querySelectorAll('.task-validation [role]')].map(e=>e.getAttribute('role'))}));
  assert.equal(geometry.colorScheme,'light');
  assert(geometry.documentWidth<=scenario.width+1,`document overflow ${JSON.stringify(geometry)}`);
  await page.locator('.task-validation').scrollIntoViewIfNeeded();
  const screenshot=path.join(evidence,scenario.name+'.png');
  await page.screenshot({path:screenshot,fullPage:true});receipt.screenshots.push(screenshot);
  await page.reload({waitUntil:'domcontentloaded'});
  await page.locator('#workspace-view-task').click();
  await page.locator('#task-section-validation').click();
  await artifact.locator(`.task-status-badge.is-${scenario.status}`).waitFor({timeout:10000});
  assert.equal(await artifact.innerText(),before);
  receipt.cases.push({name:scenario.name,status:scenario.status,rowText:before,geometry,refreshStable:true,keyboardSelection:true});
  await context.close();
 }
 assert.equal(receipt.pageErrors.length,0,JSON.stringify(receipt.pageErrors));
 assert.equal(receipt.consoleErrors.length,0,JSON.stringify(receipt.consoleErrors));
 receipt.status='passed';
}catch(error){operationError=error;receipt.status='failed';receipt.error={message:error.message,stack:error.stack};}
finally{
 try{await browserRuntime?.close();receipt.browserClosed=true;}catch(error){receipt.browserCloseError=error.message;}
 try{await server?.close();receipt.serverClosed=true;}catch(error){receipt.serverCloseError=error.message;}
 try{if(!storeClosed)await store.shutdown();}catch{}
 receipt.finishedAt=new Date().toISOString();
 await writeFile(path.join(evidence,'receipt.json'),JSON.stringify(receipt,null,2)+'\n');
 console.log(JSON.stringify(receipt,null,2));
}
if(operationError)process.exitCode=1;
