import {adminLogin,adminLogout,adminSession,requireAdminMutation} from './admin-auth';
import {HttpError,requireThat} from './config';
import {jsonBody} from './http';
import {Registry,type ClientConfig} from './registry';
import {makeIntegrationPrompt,skillMarkdown,skillZip} from './skill';
import type {Env,Store} from './types';

export async function handleAdmin(request:Request,env:Env,store:Store):Promise<Response> {
  const {pathname,search}=new URL(request.url);
  requireThat(!search,400,'INVALID_REQUEST','管理接口不接受查询参数');
  if(pathname==='/api/admin/login') {
    requireThat(request.method==='POST',405,'METHOD_NOT_ALLOWED','请求方法不支持');
    return adminLogin(request,env,await jsonBody(request,4096));
  }
  const identity=adminSession(request,env);
  if(request.method!=='GET')requireAdminMutation(request,env,identity);
  if(pathname==='/api/admin/session' && request.method==='GET')return Response.json({user:{email:identity.email},csrfToken:identity.csrfToken});
  if(pathname==='/api/admin/logout' && request.method==='POST')return adminLogout();
  if(pathname==='/api/admin/skill' && request.method==='GET')return Response.json({content:skillMarkdown()});
  if(pathname==='/api/admin/skill.zip' && request.method==='GET')return new Response(skillZip() as BodyInit,{headers:{'Content-Type':'application/zip','Content-Disposition':'attachment; filename="brclio-pay-integrate.zip"'}});
  const registry=new Registry(env,store);
  if(pathname==='/api/admin/clients' && request.method==='GET')return Response.json({clients:await registry.list()});
  if(pathname==='/api/admin/clients' && request.method==='POST') {
    const body=await jsonBody(request) as {config?:ClientConfig;expectedVersion?:string};
    requireThat(body && typeof body==='object' && body.config && typeof body.expectedVersion==='string',400,'INVALID_REQUEST','平台配置或版本缺失');
    return Response.json({client:await registry.upsertClient(body.config,body.expectedVersion,identity.email)});
  }
  if(pathname==='/api/admin/grants' && request.method==='POST') {
    const body=await jsonBody(request,16384) as {clientId:string;mode:'create'|'update';allowedOrigins:string[]};
    requireThat(body && typeof body==='object' && !Array.isArray(body) && Object.keys(body).every(key=>['clientId','mode','allowedOrigins'].includes(key)),400,'INVALID_REQUEST','授权参数无效');
    const grant=await registry.createGrant(body,identity.email);
    return Response.json({grantId:grant.id,clientId:grant.clientId,expiresAt:grant.expiresAt,prompt:makeIntegrationPrompt({clientId:grant.clientId,mode:grant.mode,token:grant.token,expiresAt:grant.expiresAt,baseUrl:env.PAY_BASE_URL,paymentMode:env.PAYMENT_MODE})});
  }
  if(pathname==='/api/admin/grants' && request.method==='GET')return Response.json({grants:await registry.listGrants()});
  const revoke=/^\/api\/admin\/grants\/(grant_[a-f0-9]{32})\/revoke$/.exec(pathname);
  if(revoke && request.method==='POST') {
    await registry.revokeGrant(revoke[1],identity.email);
    return Response.json({ok:true});
  }
  if(pathname==='/api/admin/audit' && request.method==='GET')return Response.json({entries:await registry.audit()});
  throw new HttpError(404,'NOT_FOUND','管理接口不存在');
}
