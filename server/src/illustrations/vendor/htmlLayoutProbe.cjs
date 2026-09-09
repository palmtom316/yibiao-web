// Source: palmtom316/yibiao b079bc0d923c4a533b9c2de3a9f573f4c75d8137; AGPL-3.0-only.
// Pure DOM diagnostics only; no Electron runtime.
const HTML_MIN_TEXT_FONT_SIZE = 24;
function buildHtmlLayoutProbeScript() {
  return `(() => {
    const root=document.getElementById('yibiao-capture-root')||document.body||document.documentElement;
    if(!root)return ['未找到截图画布'];
    const issues=[];
    const add=(value)=>{if(value&&!issues.includes(value)&&issues.length<12)issues.push(value)};
    const visible=(element)=>{const style=getComputedStyle(element);return style.display!=='none'&&style.visibility!=='hidden'&&Number(style.opacity||1)>0};
    const label=(element)=>{const tag=(element.tagName||'元素').toLowerCase();const className=String(element.className||'').trim().split(/\\s+/).filter(Boolean).slice(0,2).join('.');return className?tag+'.'+className:tag};
    const related=(left,right)=>left===right||left.contains(right)||right.contains(left);
    const rootRect=root.getBoundingClientRect();
    const minFontSize=${HTML_MIN_TEXT_FONT_SIZE};
    const textEntries=[];
    const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
    let node;
    while((node=walker.nextNode())){
      if(!node.nodeValue||!node.nodeValue.trim())continue;
      const element=node.parentElement;
      if(!element||!visible(element)||['script','style','noscript'].includes(element.tagName.toLowerCase()))continue;
      const range=document.createRange();range.selectNodeContents(node);
      const rects=Array.from(range.getClientRects()).filter((rect)=>rect.width>0&&rect.height>0);
      if(rects.length)textEntries.push({element,rects});
    }
    const hasInvalidTransform=(transform)=>{
      if(!transform||transform==='none')return false;
      const match=transform.match(/^matrix\\(([^)]+)\\)$/);
      if(match){const values=match[1].split(',').map(Number);return values.length!==6||Math.abs(values[1])>.01||Math.abs(values[2])>.01||values[0]<0||values[3]<0||Math.abs(Math.abs(values[0])-1)>.01||Math.abs(Math.abs(values[3])-1)>.01}
      const matrix3d=transform.match(/^matrix3d\\(([^)]+)\\)$/);
      if(matrix3d){const values=matrix3d[1].split(',').map(Number);return values.length!==16||Math.abs(values[1])>.01||Math.abs(values[4])>.01||Math.abs(values[0]-1)>.01||Math.abs(values[5]-1)>.01||values[0]<0||values[5]<0}
      return true;
    };
    for(const entry of textEntries){
      for(let element=entry.element;element&&element!==root.parentElement;element=element.parentElement){
        const style=getComputedStyle(element);
        if(hasInvalidTransform(style.transform)){add('文字存在旋转、倒置、镜像或缩放变形：'+label(element));break}
        if(style.position==='fixed'||style.position==='sticky'){add('文字使用固定或粘性定位，截图布局不稳定：'+label(element));break}
      }
      const fontSize=parseFloat(getComputedStyle(entry.element).fontSize||'0');
      if(fontSize>0&&fontSize<minFontSize)add('文字字号过小：'+label(entry.element)+' 为 '+fontSize+'px，至少需要 '+minFontSize+'px');
      for(const rect of entry.rects){
        if(rect.left<rootRect.left-1||rect.right>rootRect.right+1||rect.top<rootRect.top-1||rect.bottom>rootRect.bottom+1){add('文字超出截图画布：'+label(entry.element));break}
        for(let element=entry.element.parentElement;element&&element!==root.parentElement;element=element.parentElement){
          const style=getComputedStyle(element);
          const clipsX=['hidden','clip','scroll','auto'].includes(style.overflowX);
          const clipsY=['hidden','clip','scroll','auto'].includes(style.overflowY);
          const box=element.getBoundingClientRect();
          if((clipsX&&(rect.left<box.left-1||rect.right>box.right+1))||(clipsY&&(rect.top<box.top-1||rect.bottom>box.bottom+1))){add('文字被容器裁切：'+label(element));break}
          if(style.textOverflow==='ellipsis'&&element.scrollWidth>element.clientWidth+1){add('文字被省略截断：'+label(element));break}
        }
      }
    }
    for(let index=0;index<textEntries.length;index+=1){
      for(let next=index+1;next<textEntries.length;next+=1){
        const left=textEntries[index];const right=textEntries[next];
        if(related(left.element,right.element)||left.element===right.element)continue;
        const overlaps=left.rects.some((a)=>right.rects.some((b)=>{
          const width=Math.max(0,Math.min(a.right,b.right)-Math.max(a.left,b.left));
          const height=Math.max(0,Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top));
          return width*height>=Math.max(8,Math.min(a.width*a.height,b.width*b.height)*.2);
        }));
        if(overlaps)add('文字内容发生重叠：'+label(left.element)+' 与 '+label(right.element));
      }
    }
    for(const entry of textEntries){
      const rect=entry.rects[0];
      const points=[[rect.left+rect.width/2,rect.top+rect.height/2],[rect.left+Math.min(3,rect.width/2),rect.top+rect.height/2]];
      for(const [x,y] of points){
        if(x<rootRect.left||x>rootRect.right||y<rootRect.top||y>rootRect.bottom)continue;
        const top=document.elementsFromPoint(x,y).find((element)=>element!==document.documentElement&&element!==document.body);
        if(!top||related(top,entry.element)||!visible(top))continue;
        const style=getComputedStyle(top);
        const background=style.backgroundImage!=='none'||!/^rgba?\\([^)]*,\\s*0\\)$/.test(style.backgroundColor)||['img','svg','canvas','video'].includes(top.tagName.toLowerCase());
        if(background){add('文字被前景元素遮挡：'+label(entry.element)+' 被 '+label(top)+' 覆盖');break}
      }
    }
    for(const element of root.querySelectorAll('*')){
      if(!visible(element))continue;
      const rect=element.getBoundingClientRect();
      if(rect.width>0&&rect.height>0&&(rect.left<rootRect.left-1||rect.right>rootRect.right+1)){add('元素横向超出截图画布：'+label(element));}
    }
    if(!textEntries.length&&!root.querySelector('img,svg,canvas,video'))add('截图画布没有可见内容');
    return issues;
  })()`;
}


module.exports = { buildHtmlLayoutProbeScript };
