import {mkdirSync,copyFileSync,cpSync} from 'node:fs';
import './sync-docs.mjs';
mkdirSync('dist-pages',{recursive:true});
cpSync('public','dist-pages',{recursive:true});
copyFileSync('cloudflare/pages/_worker.js','dist-pages/_worker.js');
