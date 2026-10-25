'use strict';
const fs=require('node:fs'),path=require('node:path');
const {publicConfig}=require('../server/photo_preview_config.cjs');
const config=publicConfig(process.env);
if(!config){process.stderr.write('Staging Preview branch configuration is required.\n');process.exit(1)}
const root=path.resolve(__dirname,'..'),out=path.join(root,'public');
fs.mkdirSync(out,{recursive:true});
for(const file of ['index.html','navigation.js','404.html','preview-auth-bootstrap.js'])fs.copyFileSync(path.join(root,file),path.join(out,file));
fs.writeFileSync(path.join(out,'staging-config.js'),'window.RACK_RELIC_STAGING_CONFIG='+JSON.stringify(config)+';\n');
