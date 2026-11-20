import { useEffect, useId, useRef, useState } from "react";

export function ComplaintPicker({value,options,frequent = [],onChange}:{value:string;options:string[];frequent?:string[];onChange:(value:string)=>void}) {
  const id=useId();
  const [quickPicks] = useState(() => frequent.slice(0,5));
  const [open,setOpen]=useState(false);
  const [query,setQuery]=useState("");
  const [active,setActive]=useState(-1);
  const list=useRef<HTMLDivElement>(null);
  const choices=[...new Set([...options,...(value?[value]:[])])].filter(option=>option && option!=="Other")
    .sort((a,b)=>a.localeCompare(b));
  const terms=query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const matches=choices.filter(option=>terms.every(term=>option.toLocaleLowerCase().includes(term)));
  const results=[...matches,"Other",""];
  useEffect(()=>{list.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({block:"nearest"});},[active]);
  function choose(choice:string){onChange(choice);setOpen(false);setQuery("");setActive(-1);}
  return <div className="grid min-w-0 gap-2" onBlur={event=>{
    if(!event.currentTarget.contains(event.relatedTarget as Node|null)){setOpen(false);setQuery("");setActive(-1);}
  }}>
    <label htmlFor={id}>Chief complaint</label>
    {quickPicks.length > 0 && <div role="group" aria-label="Most used this race" className="grid gap-2">
      <p className="text-xs text-muted-foreground">Most used this race · tap to select</p>
      <div className="flex flex-wrap gap-2">{quickPicks.map(complaint => <button key={complaint} type="button" aria-pressed={value === complaint} onClick={() => choose(complaint)} className={`min-h-11 rounded-lg border px-3 py-2 text-left text-sm font-semibold ${value === complaint ? "border-signal bg-signal text-background" : "border-signal/40 bg-signal/10 text-foreground hover:border-signal"}`}>{complaint}</button>)}</div>
    </div>}
    <div className="flex min-w-0 gap-1">
      <input id={id} role="combobox" aria-autocomplete="list" aria-expanded={open} aria-controls={`${id}-list`}
        aria-activedescendant={open && active>=0 ? `${id}-option-${active}` : undefined}
        value={open?query:value} placeholder={open?"Type to search complaints…":"Not specified — tap to search"}
        autoComplete="off" autoCorrect="off" spellCheck={false}
        className="min-h-11 w-full min-w-0 rounded-sm border border-border bg-background px-3 text-sm outline-none focus:border-signal"
        onFocus={()=>{setOpen(true);setQuery("");setActive(-1);}}
        onClick={()=>{if(!open){setOpen(true);setQuery("");setActive(-1);}}}
        onChange={event=>{setQuery(event.target.value);setOpen(true);setActive(-1);}}
        onKeyDown={event=>{
          if(event.key==="Escape" && open){event.preventDefault();event.stopPropagation();setOpen(false);setQuery("");setActive(-1);}
          if(event.key==="ArrowDown" || event.key==="ArrowUp"){
            event.preventDefault();setOpen(true);
            setActive(index=>event.key==="ArrowDown"?Math.min(index+1,results.length-1):Math.max(index-1,0));
          }
          if(event.key==="Enter" && open){event.preventDefault();if(active>=0 && results[active]!==undefined)choose(results[active]!);}
        }} />
      {value && <button type="button" aria-label="Clear chief complaint" onClick={()=>choose("")} className="min-h-11 rounded border border-border px-3 text-sm">Clear</button>}
    </div>
    {open && <>
      {value && <p className="text-xs text-muted-foreground">Current: {value}</p>}
      {matches.length===0 && <p role="status" className="text-sm text-muted-foreground">No matching complaints. Choose Other to enter one.</p>}
      <div id={`${id}-list`} ref={list} role="listbox" aria-label="Chief complaint options" className="max-h-52 overflow-y-auto overscroll-contain rounded border border-border bg-background">
        {results.map((choice,index)=><button type="button" role="option" aria-selected={choice===value} tabIndex={-1}
          key={choice || "unspecified"} id={`${id}-option-${index}`} data-index={index}
          className={`block min-h-11 w-full break-words border-b border-border px-3 py-2 text-left text-sm last:border-b-0 ${active===index?"bg-signal/20":"hover:bg-muted"}`}
          onMouseDown={event=>event.preventDefault()} onClick={()=>choose(choice)}>{choice || "Not specified"}</button>)}
      </div>
    </>}
  </div>;
}
