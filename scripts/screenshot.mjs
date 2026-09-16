import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
const dir = process.argv[2], out = process.argv[3], w = +(process.argv[4]||420), h = +(process.argv[5]||780);
const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css'};
const server=createServer(async(req,res)=>{const rel=decodeURIComponent((req.url??'/').split('?')[0]);const f=path.join(dir,rel==='/'?'index.html':rel);try{res.writeHead(200,{'content-type':MIME[path.extname(f)]??'application/octet-stream'});res.end(await readFile(f));}catch{res.writeHead(404).end('x');}});
await new Promise(r=>server.listen(0,r));
const port=server.address().port;
const b=await chromium.launch();const p=await b.newPage({viewport:{width:w,height:h}});
await p.goto(`http://127.0.0.1:${port}/`);await p.waitForTimeout(700);
await p.screenshot({path:out});
if(process.argv[6]==='deep'){await p.fill('input[type="search"]','biryani');await p.waitForTimeout(300);await p.click('.t-card');await p.waitForTimeout(300);await p.screenshot({path:out.replace('.png','-restaurant.png')});await p.click('.t-add');await p.waitForTimeout(200);await p.click('[aria-label^="Cart,"]');await p.waitForTimeout(300);await p.screenshot({path:out.replace('.png','-cart.png')});}
await b.close();server.close();
