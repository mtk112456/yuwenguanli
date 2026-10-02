const fs=require('fs'),assert=require('assert');
const {chromium}=require('C:/Users/MTK/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root='D:/DeskBox/班级量化考核系统/班级量化考核管理系统网页前后端/admin/teacher/';
(async()=>{
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});const page=await browser.newPage({viewport:{width:390,height:844}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
let updates=[],query='not_found',storeFail=false,stores=0;
const html=`<meta charset="utf-8"><body class="ta-body ta-task-mode" data-admin-id="1"><div class="ta-task-body" id="task"></div><section id="sheet" style="position:fixed;inset:10px;z-index:9999;background:white;padding:20px;overflow:auto;display:none"></section><script>
window.TE={tasks:{}};window.TA={escapeHtml:s=>String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),request:async(u,o)=>{let r=await fetch(new URL(u,'https://fixture.test/admin/teacher/index.php'),{...o,headers:{'Content-Type':'application/x-www-form-urlencoded'}});return r.json();},toast:s=>window.lastToast=s,confirm:async()=>true,openSheet:(t,c,ready)=>{let el=document.querySelector('#sheet');el.style.display='block';el.innerHTML='';if(typeof c==='string')el.innerHTML=c;else el.append(c);if(ready)ready(el);},closeSheet:()=>{let el=document.querySelector('#sheet');el.style.display='none';el.innerHTML='';}};
</script><script src="/classroom.js"></script><script>TE.tasks.classroom(document.querySelector('#task'),{},{});</script></body>`;
await page.route('https://fixture.test/**',async r=>{
 const u=r.request().url();if(u.endsWith('/classroom.js'))return r.fulfill({contentType:'application/javascript; charset=utf-8',body:fs.readFileSync(root+'teacher-classroom.js','utf8')});
 if(u.includes('/api/')){
 let data={list:[]};if(u.includes('class/list'))data={list:[{id:77,name:'模拟班'}]};
 if(u.includes('classroom_list'))data={students:[{id:1,name:'学生一',show_name:'学生一',score:100,version:1}],class_id:77,class_name:'模拟班'};
 if(u.includes('batch_update')){updates.push(r.request().postData());if(updates.length===1)return r.abort();data={success:1,log_ids:[888],failed_detail:[]};}
 if(u.includes('op_result'))data=query==='completed'?{status:'completed',success:1,log_ids:[888],failed_detail:[]}:{status:'not_found'};
 if(u.includes('batch_store')){stores++;if(storeFail)return r.fulfill({contentType:'application/json',body:JSON.stringify({code:1,msg:'模拟归组失败'})});data={id:901};}
 return r.fulfill({contentType:'application/json',body:JSON.stringify({code:0,data})});
 }return r.fulfill({contentType:'text/html',body:html});
});
async function load(){await page.goto('https://fixture.test/page');await page.addStyleTag({content:fs.readFileSync(root+'teacher.css','utf8')});await page.waitForSelector('.ta-score-row');}
await load();await page.locator('.ta-score-row').click();await page.locator('#taCmGo').click();await page.locator('#taCmExec').click();await page.waitForSelector('#taPendResend');assert.equal(updates.length,1);
const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('cm_pending_1')));assert(saved.opKey);console.log('P1 PASS: 网络失败保留操作，只读查询不重发');
await load();await page.waitForSelector('#taCmPendEntry');const reloaded=await page.evaluate(()=>JSON.parse(localStorage.getItem('cm_pending_1')));assert.equal(saved.opKey,reloaded.opKey);console.log('P2 PASS: 刷新保留原键原参数');
query='completed';storeFail=true;await page.locator('#taCmPendEntry').click();await page.waitForSelector('#taCmRetryGroup');assert.equal(updates.length,1);assert.equal(await page.evaluate(()=>localStorage.getItem('cm_pending_1')),null);console.log('P3 PASS: 查询完成共用收尾，不重复记分');
await load();await page.waitForSelector('#taCmGrpEntry');storeFail=false;await page.locator('#taCmGrpEntry').click();await page.waitForFunction(()=>!document.querySelector('#taCmGrpEntry'));assert.equal(updates.length,1);assert.equal(await page.evaluate(()=>localStorage.getItem('cm_group_1')),null);console.log('P4 PASS: 待归组刷新恢复，仅重试归组');
await page.waitForTimeout(150);await page.evaluate(()=>{document.body.dataset.adminId='';});if(!(await page.locator('.ta-score-row').getAttribute('class')).includes('checked'))await page.locator('.ta-score-row').click();await page.locator('#taCmGo').click();assert.equal(updates.length,1);console.log('identity toast:',await page.evaluate(()=>lastToast),'errors:',errors);assert((await page.evaluate(()=>lastToast)).includes('身份'));console.log('PASS: 缺失身份禁止提交');
await page.evaluate(()=>{document.body.dataset.adminId='1';});
fs.mkdirSync('outputs/classroom-ui',{recursive:true});
for(const width of [360,390,430])for(const theme of ['ink_blue','bamboo_green','imperial_purple','warm_paper','misty_cyan']){
 await page.setViewportSize({width,height:844});await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.locator('#taCmGo').click({trial:true});
 await page.screenshot({path:'outputs/classroom-ui/'+width+'-'+theme+'.png',fullPage:true});
}
console.log('PASS: 三宽度五主题模块布局与正常点击检查');
assert.deepEqual(errors,[]);console.log('JS errors: 0');await browser.close();
})().catch(e=>{console.error(e);process.exit(1);});
