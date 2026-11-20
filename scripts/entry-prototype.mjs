import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {Script} from 'node:vm';
import {build} from 'vite';

const root=fileURLToPath(new URL('..',import.meta.url));
const normalizeNewlines=text=>text.replace(/\r\n/g,'\n');
const result=await build({configFile:false,root,publicDir:false,logLevel:'error',plugins:[{
  name:'entry-prototype-css-newlines',
  enforce:'pre',
  transform(source,id){
    if(id.endsWith('.css?inline'))return normalizeNewlines(source);
  },
}],build:{write:false,emptyOutDir:false,minify:false,
  rollupOptions:{input:resolve(root,'src/entry-prototype.ts'),output:{format:'iife',inlineDynamicImports:true,entryFileNames:'entry-prototype.js'}}}});
const outputs=Array.isArray(result)?result:[result];
const chunks=outputs.flatMap(item=>item.output??[]).filter(item=>item.type==='chunk');
assert.equal(chunks.length,1,'Prototype must be a self-contained browser bundle');
const code=chunks[0].code;new Script(code,{filename:'entry-prototype.js'});
assert.ok(!/\bfetch\s*\(|getUserMedia|speechSynthesis|XMLHttpRequest|WebSocket|\/api\//.test(code),'Prototype cannot call application/cloud/media APIs');
const manifest=JSON.parse(readFileSync(resolve(root,'docs/ASSETS.json'),'utf8'));
assert.ok(code.includes(manifest.themeId),'Prototype must reuse the approved visual theme');
assert.ok(code.includes('entry-home')&&code.includes('127.0.0.1:8787/'),'Prototype must retain the original home styling and real application entry');
const template=normalizeNewlines(readFileSync(resolve(root,'scripts/entry-prototype.template.html'),'utf8'));
assert.equal(template.split('__ENTRY_PROTOTYPE_CODE__').length,2);
const html=template.replace('__ENTRY_PROTOTYPE_CODE__',()=>code.replace(/<\/script/gi,'<\\/script'));
const file=resolve(root,'docs/ENTRY_PROTOTYPE.html');
if(process.argv.includes('--check'))assert.equal(normalizeNewlines(readFileSync(file,'utf8')),html,'Prototype snapshot is stale. Run npm run prototype:build');
else writeFileSync(file,html,'utf8');
console.log(`Entry prototype ${process.argv.includes('--check')?'verified':'generated'}: standalone example state, no application/cloud/media calls.`);
