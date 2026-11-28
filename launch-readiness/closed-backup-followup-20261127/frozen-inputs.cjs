'use strict';
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const {createHash}=require('node:crypto');
const carrier=readFileSync(join(__dirname,'../closed-backup-continuation-20261127.json'));
const blobHash=createHash('sha1').update('blob '+carrier.length+'\0').update(carrier).digest('hex');
if (blobHash!=='236663e561cd6445b8921b9cfd61ad35bcc6c7ce') throw Error('FROZEN_CARRIER_CHANGED');
const allowed=new Set([
 'README.txt','closed-install.cjs','closed-install.test.cjs','fixture-pin.json','package.json',
 'reviewed-inputs/archive_dispatch_once_v2.sql','reviewed-inputs/archive_write_journal.sql',
 'reviewed-inputs/archive_write_original_lookup.sql','reviewed-inputs/schedule_ticket_v1.sql',
]);
const files=new Map();
let total=0;
for (const {path,content,bytes,sha256} of JSON.parse(carrier).files) {
 const buffer=Buffer.from(content,'utf8');
 if (!allowed.has(path)||files.has(path)||buffer.length!==bytes||
     createHash('sha256').update(buffer).digest('hex')!==sha256) throw Error('FROZEN_FILE_CHANGED');
 files.set(path,content);
 total+=bytes;
}
if (files.size!==allowed.size||total!==56183) throw Error('FROZEN_INVENTORY_CHANGED');
function readFrozen(name) {
 if (!files.has(name)) throw Error('FROZEN_PATH_HELD');
 return files.get(name);
}
module.exports={readFrozen};
