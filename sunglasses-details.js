/* Editable description prompts only. No automatic save, upload or provider access. */
(function(root){
  'use strict';
  const heading='Sunglasses details:';
  const checklist=[heading,'Model:','Frame shape:','Frame color:','Lens color:',
    'Lens width / bridge / temple (mm):','Frame width (mm):','Lens condition / scratches:',
    'Hinges / repairs / replacement lenses:','Included case / cloth:',
    'Polarization / UV markings (only if supported):'].join('\n');
  function addChecklist(current){
    if(typeof current!=='string')throw new TypeError('Expected a description');
    if(/(?:^|\r?\n)Sunglasses details:(?:\r?\n|$)/.test(current))return {value:current,changed:false,reason:'present'};
    const value=current+(current?'\n\n':'')+checklist;
    if(value.length>2000)return {value:current,changed:false,reason:'limit'};
    return {value,changed:true,reason:'added'};
  }
  if(typeof module!=='undefined'&&module.exports){module.exports={addChecklist,checklist};return;}
  const button=root.document.getElementById('add-sunglasses-checklist');
  if(!button)return;
  const description=root.document.getElementById('listing-description');
  const status=root.document.getElementById('sunglasses-checklist-status');
  if(!description||!status)return;
  const defaultStatus=status.textContent;
  description.form?.addEventListener('reset',()=>{status.textContent=defaultStatus;});
  button.addEventListener('click',()=>{
    const result=addChecklist(description.value);
    if(result.changed){
      description.value=result.value;
      description.dispatchEvent(new Event('input',{bubbles:true}));
      status.textContent='Checklist added. Fill in what you know and remove unused prompts before saving.';
      description.focus();
    }else status.textContent=result.reason==='present'?'Your description already contains the sunglasses checklist.':'Your description is close to the 2,000-character limit. Add the details manually or shorten it first.';
  });
})(typeof window!=='undefined'?window:globalThis);
