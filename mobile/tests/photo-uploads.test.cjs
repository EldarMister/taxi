const fs=require('fs'),vm=require('vm'),ts=require('typescript'),assert=require('node:assert/strict'),{test}=require('node:test');
const moduleObject={exports:{}};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/registration/photoUploads.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports:moduleObject.exports});
const {uploadedPhoto,previousPhoto}=moduleObject.exports;
test('confirmed count ignores empty, pending and deleted photos, retaining a confirmed replacement until success',()=>{
 const old={id:'old',slotKey:'taxi_photo_front',kind:'VEHICLE_PHOTO',remoteUrl:'/api/photo',status:'UPLOADED'};
 assert.equal(uploadedPhoto(undefined),false);assert.equal(uploadedPhoto({slotKey:'x',localUri:'file://x',status:'UPLOADING'}),false);
 assert.equal(uploadedPhoto(old),true);assert.equal(uploadedPhoto({...old,pendingDelete:true}),false);
 const replacement={...old,localUri:'file://new',status:'UPLOADING',previousUpload:previousPhoto(old)};
 assert.equal(uploadedPhoto(replacement),true);assert.equal(previousPhoto(replacement).id,'old');
 assert.equal(previousPhoto({status:'QUEUED',localUri:'file://first'}),undefined);
});
