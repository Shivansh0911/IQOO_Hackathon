import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
const dist = path.resolve(import.meta.dirname, '../apps/demo/dist');
const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json'};
const server=createServer(async(req,res)=>{const rel=decodeURIComponent((req.url??'/').split('?')[0]);const f=path.join(dist,rel==='/'?'index.html':rel);let body;try{body=await readFile(f);}catch{res.writeHead(404).end('x');return;}res.writeHead(200,{'content-type':MIME[path.extname(f)]??'application/octet-stream',...(process.env.NOCOOP?{}:{'Cross-Origin-Opener-Policy':'same-origin'})});res.end(body);});
await new Promise(r=>server.listen(4320,'127.0.0.1',r));
const b=await chromium.launch({headless:false,ignoreDefaultArgs:['--disable-gpu'],args:['--disable-gpu']});
const ctx=await b.newContext({viewport:{width:1360,height:900},...(process.env.NOPERM?{}:{permissions:[]})});
const p=await ctx.newPage();
p.on('pageerror',e=>console.log('PAGEERROR:',String(e).slice(0,250)));p.on('console',m=>console.log('CONSOLE['+m.type()+']:',m.text().slice(0,200)));
await p.goto('http://127.0.0.1:4320/');
await p.waitForSelector('.tiffin');
await p.fill('textarea','add an item from the first biryani restaurant and check the cart total is under 500');
await p.locator('button.btn-primary',{hasText:'Run'}).click();
console.log('goal value:', JSON.stringify(await p.inputValue('textarea')));
console.log('btn-primary count:', await p.locator('button.btn-primary').count());
console.log('run btn count:', await p.locator('button.btn-primary',{hasText:'Run'}).count());
await p.waitForTimeout(1500);
console.log('at 1.5s rows:', await p.evaluate(()=>document.querySelectorAll('.row').length), 'thinking:', await p.evaluate(()=>document.querySelector('.thinking')?.textContent??'none'));
await p.waitForTimeout(3500);
console.log(JSON.stringify(await p.evaluate(()=>({
  rows: document.querySelectorAll('.row').length,
  verdict: document.querySelector('.verdict-tag')?.textContent??'none',
  reason: document.querySelector('.verdict-reason')?.textContent??'none',
  meta: document.querySelector('.verdict-meta')?.textContent??'none',
  logH: Math.round(document.querySelector('.log')?.getBoundingClientRect().height??-1),
  verdictH: Math.round(document.querySelector('.verdict')?.getBoundingClientRect().height??-1),
})),null,1));
await b.close(); server.close();
