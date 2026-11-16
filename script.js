'use strict';
const SIZE = 512;
function prepare(data, width = SIZE, height = SIZE) {
  const n = width * height, removed = new Uint8Array(n), queued = new Uint8Array(n), queue = new Int32Array(n);
  let head = 0, tail = 0;
  // Only seed locally uniform edges: a detailed subject touching an edge is preserved.
  const seeds = [];
  const corners=[0,width-1,(height-1)*width,n-1].filter(p=>data[p*4+3]>=128);
  const distance=(a,b)=>Math.max(...[0,1,2].map(c=>Math.abs(data[a*4+c]-data[b*4+c])));
  const background=corners.sort((a,b)=>corners.filter(p=>distance(b,p)<=25).length-corners.filter(p=>distance(a,p)<=25).length)[0];
  function edge(p, next) {
    const i = p * 4, j = next * 4;
    if (data[i + 3] < 128) { seeds.push([p, null]); return; }
    if (background!==undefined && distance(p,background)<=25 && Math.max(Math.abs(data[i]-data[j]),Math.abs(data[i+1]-data[j+1]),Math.abs(data[i+2]-data[j+2])) <= 25)
      seeds.push([p, [data[background*4],data[background*4+1],data[background*4+2]]]);
  }
  for (let x=0;x<width;x++) { edge(x, Math.min(width-1,x+1)); edge((height-1)*width+x,(height-1)*width+Math.max(0,x-1)); }
  for (let y=0;y<height;y++) { edge(y*width,Math.min(height-1,y+1)*width); edge(y*width+width-1,Math.max(0,y-1)*width+width-1); }
  for (const [seed,color] of seeds) {
    if (removed[seed]) continue;
    head=0;tail=0;queue[tail++]=seed;queued[seed]=1;
    while(head<tail) {
      const p=queue[head++],i=p*4;
      if (data[i+3]>=128 && (!color || Math.max(Math.abs(data[i]-color[0]),Math.abs(data[i+1]-color[1]),Math.abs(data[i+2]-color[2]))>25)) continue;
      removed[p]=1;
      const x=p%width,y=Math.floor(p/width);
      for(const q of [x>0?p-1:-1,x<width-1?p+1:-1,y>0?p-width:-1,y<height-1?p+width:-1]) {
        if(q>=0&&!queued[q]&&!removed[q]){queued[q]=1;queue[tail++]=q;}
      }
    }
    for(let k=0;k<tail;k++) queued[queue[k]]=0;
  }
  const gray=new Float32Array(n),mask=new Uint8Array(n),hist=new Uint32Array(256);let count=0;
  for(let p=0;p<n;p++) if(!removed[p]&&data[p*4+3]>=128){const i=p*4,v=Math.round(.2126*data[i]+.7152*data[i+1]+.0722*data[i+2]);gray[p]=v;mask[p]=1;hist[v]++;count++;}
  function percentile(f){let sum=0;for(let i=0;i<256;i++){sum+=hist[i];if(sum>=Math.max(1,count*f))return i;}return 255;}
  const low=percentile(.01),high=percentile(.99);
  for(let p=0;p<n;p++) if(mask[p]) gray[p]=high>low?Math.max(0,Math.min(1,(gray[p]-low)/(high-low))):gray[p]/255;
  enhanceDetails(gray,mask,width,height);
  return {gray,mask};
}
function enhanceDetails(gray,mask,width,height){
  // Mask-aware local statistics separate broad shading from facial and clothing details.
  const stride=width+1,length=stride*(height+1);
  const sum=new Float64Array(length),square=new Float64Array(length),count=new Uint32Array(length);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const p=y*width+x,i=(y+1)*stride+x+1,v=mask[p]?gray[p]:0;
    sum[i]=v+sum[i-1]+sum[i-stride]-sum[i-stride-1];
    square[i]=v*v+square[i-1]+square[i-stride]-square[i-stride-1];
    count[i]=mask[p]+count[i-1]+count[i-stride]-count[i-stride-1];
  }
  function area(table,x,y,r){
    const l=Math.max(0,x-r),t=Math.max(0,y-r),rr=Math.min(width,x+r+1),b=Math.min(height,y+r+1);
    return table[b*stride+rr]-table[t*stride+rr]-table[b*stride+l]+table[t*stride+l];
  }
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const p=y*width+x;if(!mask[p])continue;
    const samples=area(count,x,y,12),mean=area(sum,x,y,12)/samples;
    const deviation=Math.sqrt(Math.max(0,area(square,x,y,12)/samples-mean*mean));
    const gain=Math.min(3.5,.18/Math.max(.045,deviation));
    const local=.5+(gray[p]-mean)*gain;
    const fineMean=area(sum,x,y,2)/area(count,x,y,2);
    gray[p]=Math.max(0,Math.min(1,.55*gray[p]+.45*local+.65*(gray[p]-fineMean)));
  }
}
function halftone(light,dark,width=SIZE,height=SIZE){
  const out=new Uint8ClampedArray(width*height*4);
  for(const [parity,source] of [[0,light],[1,dark]]){
    const errors=new Float32Array(width*height);
    function spread(x,y,error,weight){
      if(x<0||x>=width||y>=height)return;
      const p=y*width+x;
      if(source.mask[p])errors[p]+=error*weight;
    }
    for(let y=0;y<height;y++){
      const direction=y%2===0?1:-1;
      for(let step=0;step<width;step++){
        const x=direction===1?step:width-1-step,p=y*width+x;
        // Every pixel belongs to one layer; adjacent same-layer sites are <= 2 px apart.
        if(((x+y)&1)!==parity||!source.mask[p])continue;
        const tone=parity?source.gray[p]:1-source.gray[p];
        const value=tone+errors[p];
        const ink=value>=.5?1:0,error=value-ink;
        if(ink){const i=p*4;out[i]=out[i+1]=out[i+2]=parity?255:0;out[i+3]=255;}
        // Diffuse on the checkerboard itself, avoiding the old repeating 8 px pattern.
        spread(x+2*direction,y,error,7/16);
        spread(x-direction,y+1,error,3/16);
        spread(x+direction,y+1,error,5/16);
        spread(x,y+2,error,1/16);
      }
    }
  }
  return out;
}
if(typeof module!=='undefined')module.exports={prepare,halftone,enhanceDetails};
if(typeof document!=='undefined'){
  const canvas=document.querySelector('#result'),ctx=canvas.getContext('2d'),images={light:null,dark:null},versions={light:0,dark:0};
  const status=document.querySelector('#status'),download=document.querySelector('#download'),compare=document.querySelector('#compare');
  function render(){
    download.disabled=compare.disabled=true;
    if(!images.light||!images.dark){status.hidden=false;status.textContent='Загрузите два изображения';return;}
    const output=halftone(images.light,images.dark);ctx.putImageData(new ImageData(output,SIZE,SIZE),0,0);
    for(const c of document.querySelectorAll('#split .sticker'))c.getContext('2d').putImageData(new ImageData(output,SIZE,SIZE),0,0);
    status.hidden=true;download.disabled=compare.disabled=false;
  }
  for(const id of ['light','dark'])document.querySelector('#'+id).addEventListener('change',async event=>{
    const version=++versions[id],file=event.target.files[0];images[id]=null;render();if(!file)return;
    const label=document.querySelector('#'+id+'-status');label.textContent='Обработка…';const url=URL.createObjectURL(file);
    try{const image=new Image();image.src=url;await image.decode();if(version!==versions[id])return;
      if(!image.naturalWidth||!image.naturalHeight)throw Error('image');
      const c=document.createElement('canvas');c.width=c.height=SIZE;const context=c.getContext('2d',{willReadFrequently:true});
      const scale=Math.min(SIZE/image.naturalWidth,SIZE/image.naturalHeight),w=image.naturalWidth*scale,h=image.naturalHeight*scale;
      context.drawImage(image,(SIZE-w)/2,(SIZE-h)/2,w,h);
      const original=document.querySelector('#original-'+id);original.getContext('2d').clearRect(0,0,SIZE,SIZE);original.getContext('2d').drawImage(c,0,0);
      images[id]=prepare(context.getImageData(0,0,SIZE,SIZE).data);label.textContent=file.name;render();
    }catch(error){if(version===versions[id]){label.textContent='Не удалось прочитать изображение. Выберите другой файл.';}}
    finally{URL.revokeObjectURL(url);}
  });
  document.querySelector('#background').addEventListener('change',e=>document.querySelector('#stage').className='stage '+e.target.value);
  compare.addEventListener('click',()=>{const split=document.querySelector('#split');split.hidden=!split.hidden;compare.setAttribute('aria-expanded',String(!split.hidden));});
  download.addEventListener('click',()=>canvas.toBlob(blob=>{if(!blob)return;const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='chameleon-512.png';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);},'image/png'));
}
