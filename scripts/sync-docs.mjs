import {mkdirSync,copyFileSync} from 'node:fs';
mkdirSync('public/docs',{recursive:true});
for(const name of ['integration','alipay-setup','architecture','deployment','application-profile'])copyFileSync(`docs/${name}.md`,`public/docs/${name}.md`);
