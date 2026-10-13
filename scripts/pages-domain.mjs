// Local setup only: reuse Wrangler's existing OAuth session without printing credentials.
import {readFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {fetch,ProxyAgent} from 'undici';
const [action='status']=process.argv.slice(2);
if(!['status','add'].includes(action))throw new Error('Usage: node scripts/pages-domain.mjs status|add');
const config=readFileSync(join(homedir(),'Library/Preferences/.wrangler/config/default.toml'),'utf8');
const token=/^oauth_token\s*=\s*"([^"]+)"/m.exec(config)?.[1];
if(!token)throw new Error('Sign in with wrangler login first');
const proxy=process.env.HTTPS_PROXY || process.env.https_proxy;
const dispatcher=proxy?new ProxyAgent(proxy):undefined;
const base='https://api.cloudflare.com/client/v4/accounts/c8b059429c868f6d0e528f9e10325f46/pages/projects/brclio-pay/domains';
try {
  const response=await fetch(action==='add'?base:base+'/pay.bornforthis.cn',{method:action==='add'?'POST':'GET',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(action==='add'?{body:JSON.stringify({name:'pay.bornforthis.cn'})}:{}),dispatcher,redirect:'error'});
  const result=await response.json();
  console.log(JSON.stringify({httpStatus:response.status,success:result.success,domain:result.result?.name,status:result.result?.status,validation:result.result?.validation_data,verification:result.result?.verification_data,errors:result.errors?.map(e=>({code:e.code,message:e.message}))}));
  if(!response.ok)process.exitCode=1;
}catch{console.error('Cloudflare domain request failed');process.exitCode=1;}finally{await dispatcher?.close();}
