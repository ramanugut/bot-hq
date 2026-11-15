// One stylesheet for every component. It reads only the compiled CSS variables.
// Textures avoid CSS blur and backdrop filters on purpose: they are slow to render on a small server.
export const TEXTURE = {
  flat: "",
  grain: `.tex{opacity:.16;mix-blend-mode:overlay;background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='240' height='240'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' seed='7'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>")}`,
  paper: `.tex{opacity:.22;mix-blend-mode:multiply;background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='300' height='300'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.035' numOctaves='4' seed='3'/><feColorMatrix values='0 0 0 0 .5  0 0 0 0 .45  0 0 0 0 .38  0 0 0 .9 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>")}`,
  mesh: `.tex{opacity:.55;background:radial-gradient(60% 55% at 18% 22%,var(--accent),transparent 70%),radial-gradient(55% 60% at 85% 80%,var(--accent2),transparent 70%),radial-gradient(45% 45% at 70% 15%,var(--primary),transparent 70%)}`,
  glass: `.tex{opacity:.5;background:radial-gradient(50% 50% at 25% 30%,var(--accent),transparent 70%),radial-gradient(50% 50% at 80% 75%,var(--accent2),transparent 70%)}
.panel,.uiframe,.icell,.layout-cards .content{background:color-mix(in srgb,var(--surface) 62%,transparent)!important;border:1px solid color-mix(in srgb,var(--text) 22%,transparent)}`,
  scanline: `.tex{opacity:.3;background:repeating-linear-gradient(0deg,rgba(0,0,0,.55) 0 2px,transparent 2px 5px)}`,
};

export const CSS = `
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:var(--W);height:var(--H);overflow:hidden;background:var(--bg)}
#root{position:relative;width:var(--W);height:var(--H);overflow:hidden;font-family:var(--font-body),sans-serif;font-weight:var(--w-body);color:var(--text)}
.beat{position:absolute;inset:0;overflow:hidden}
.stage{position:absolute;inset:0;background:var(--bg);overflow:hidden}
.bg,.tex,.amb{position:absolute;inset:0}
.tex{pointer-events:none}
.content{position:absolute;inset:var(--mt) var(--mx) var(--mb) var(--mx);display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center;gap:calc(var(--u)*3.2)}
.w{display:inline-block;white-space:nowrap}
.em{color:var(--accent)}
.hero,.brand,.num{font-family:var(--font-display),sans-serif;font-weight:var(--w-display);letter-spacing:var(--tracking);text-transform:var(--upper);line-height:1.02;font-size:calc(var(--u)*17*var(--ts));max-width:100%}
.headline,.title,.qtext{font-family:var(--font-display),sans-serif;font-weight:var(--w-display);letter-spacing:var(--tracking);text-transform:var(--upper);line-height:1.08;font-size:calc(var(--u)*11*var(--ts));max-width:100%}
.title{font-size:calc(var(--u)*8.5*var(--ts))}
.label,.itxt,.ptext,.qby,.steptxt,.ilabel,.caption-line,.sname,.btntxt,.tagline{font-size:calc(var(--u)*5);line-height:1.25}
.plabel,.xl,.bval,.stitle{font-size:calc(var(--u)*3.4);line-height:1.2;letter-spacing:.04em;text-transform:uppercase;font-weight:var(--w-bold);color:var(--muted)}
.label,.qby,.tagline,.caption-line{color:var(--muted)}

/* decor: shape language */
.decor{position:absolute;display:block;opacity:.4;background:var(--tone)}
.d-sharp{clip-path:polygon(0 0,100% 0,100% 100%)}
.d-rounded{border-radius:28%}
.d-blob{border-radius:62% 38% 55% 45%/48% 60% 40% 52%}
.d-line{background:none;border:calc(var(--u)*.35) solid var(--tone);border-radius:50%}
.d-chunky{box-shadow:calc(var(--u)*1.4) calc(var(--u)*1.4) 0 var(--text);opacity:.85}
.d-isometric{clip-path:polygon(50% 0,100% 25%,100% 75%,50% 100%,0 75%,0 25%)}
.d-hand-drawn{background:none;border:calc(var(--u)*.45) solid var(--tone);border-radius:255px 18px 225px 18px/18px 225px 18px 255px}
.d-pixel{background:conic-gradient(var(--tone) 25%,transparent 0 50%,var(--tone) 0 75%,transparent 0);background-size:50% 50%;opacity:.4}

/* layouts */
.layout-editorial .content,.layout-grid .content,.layout-split .content{align-items:flex-start;text-align:left}
.layout-editorial .content{justify-content:flex-end}
.layout-grid .stage::before{content:"";position:absolute;inset:0;background:linear-gradient(90deg,color-mix(in srgb,var(--text) 9%,transparent) 1px,transparent 1px);background-size:calc(100%/12) 100%}
.layout-split .stage::after{content:"";position:absolute;top:0;bottom:0;right:0;width:26%;background:var(--surface)}
.layout-split .content{right:32%}
.layout-split .amb{z-index:2}
.layout-full-bleed .hero,.layout-full-bleed .brand{font-size:calc(var(--u)*22*var(--ts))}
.layout-cards .content{padding:calc(var(--u)*6);background:var(--surface);color:var(--on-surface);border-radius:var(--radius)}
.landscape.layout-split .content{right:34%}

/* components */
.stat{display:flex;flex-direction:column;align-items:inherit;gap:calc(var(--u)*1.5);max-width:100%}
.num{font-size:calc(var(--u)*28*var(--ts));color:var(--accent);font-variant-numeric:tabular-nums;white-space:nowrap}
.list{list-style:none;display:flex;flex-direction:column;gap:calc(var(--u)*3.4);align-items:flex-start;text-align:left;max-width:100%}
.item{display:flex;align-items:center;gap:calc(var(--u)*2.2)}
.bullet{flex:none;width:calc(var(--u)*3);height:calc(var(--u)*3);background:var(--accent);border-radius:var(--radius)}
.itxt{font-size:calc(var(--u)*7);font-weight:var(--w-bold)}
.compare{display:flex;gap:calc(var(--u)*3);align-items:stretch;width:100%}
.portrait .compare{flex-direction:column}
.panel{flex:1;min-width:0;min-height:calc(var(--u)*30);padding:calc(var(--u)*5);background:var(--surface);color:var(--on-surface);border-radius:var(--radius);display:flex;flex-direction:column;gap:calc(var(--u)*1.5);text-align:left;justify-content:center}
.panel.pr{outline:calc(var(--u)*.5) solid var(--accent)}
.panel .plabel{color:color-mix(in srgb,currentColor 70%,transparent)}
.ptext{font-size:calc(var(--u)*6.6);font-weight:var(--w-bold)}
.vs{flex:none;width:calc(var(--u)*.5);background:var(--accent);border-radius:99px}
.portrait .vs{width:auto;height:calc(var(--u)*.5)}
.bars{display:flex;align-items:flex-end;gap:calc(var(--u)*4);height:calc(var(--u)*46);width:100%;justify-content:center}
.barcol{flex:1;max-width:calc(var(--u)*20);height:100%;display:flex;flex-direction:column;gap:calc(var(--u)*1.2);align-items:center;text-align:center}
.bartrack{flex:1;width:100%;display:flex;align-items:flex-end}
.bar{width:100%;background:var(--primary);border-radius:var(--radius) var(--radius) 0 0}
.barcol:last-child .bar{background:var(--accent)}
.bval{color:var(--text)}
.linewrap{width:100%;height:calc(var(--u)*32)}
.linechart{width:100%;height:100%;overflow:visible}
.line-fg{fill:none;stroke:var(--accent);stroke-width:calc(var(--u)*.9);stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:1}
.xlabels{display:flex;justify-content:space-between;width:100%}
.ringwrap{position:relative;width:calc(var(--u)*46);height:calc(var(--u)*46)}
.ring{width:100%;height:100%}
.ring-bg{fill:none;stroke:var(--surface);stroke-width:9}
.ring-fg{fill:none;stroke:var(--accent);stroke-width:9;stroke-linecap:round}
.ringnum{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:calc(var(--u)*10*var(--ts))}
.qmark{font-family:var(--font-display),serif;font-weight:var(--w-display);font-size:calc(var(--u)*22);line-height:.6;height:calc(var(--u)*9);color:var(--accent)}
.qtext{font-size:calc(var(--u)*10*var(--ts))}
.steps{position:relative;display:flex;gap:calc(var(--u)*3);width:100%;align-items:flex-start}
.portrait .steps{flex-direction:column;gap:calc(var(--u)*4)}
.step{flex:1;flex-direction:column;align-items:flex-start;text-align:left;gap:calc(var(--u)*1.6);min-width:0}
.portrait .step{flex-direction:row;align-items:center}
.stepnum{flex:none;width:calc(var(--u)*11);height:calc(var(--u)*11);display:flex;align-items:center;justify-content:center;background:var(--accent);color:var(--on-accent);border-radius:var(--radius);font-family:var(--font-display),sans-serif;font-weight:var(--w-display);font-size:calc(var(--u)*5.6)}
.stepline{position:absolute;left:0;right:0;top:calc(var(--u)*5.5);height:calc(var(--u)*.4);background:color-mix(in srgb,var(--text) 30%,transparent)}
.portrait .stepline{left:calc(var(--u)*5.5);right:auto;top:0;bottom:0;width:calc(var(--u)*.4);height:auto}
.stepnum{position:relative}
.steptxt{font-weight:var(--w-bold);font-size:calc(var(--u)*5.6)}
.igrid{display:grid;grid-template-columns:repeat(3,1fr);gap:calc(var(--u)*3);width:100%}
.igrid.n2,.igrid.n4{grid-template-columns:repeat(2,1fr)}
.portrait .igrid{grid-template-columns:repeat(2,1fr)}
.icell{flex-direction:column;gap:calc(var(--u)*2.2);padding:calc(var(--u)*5) calc(var(--u)*3);background:var(--surface);color:var(--on-surface);border-radius:var(--radius);text-align:center;min-width:0}
.ico{width:calc(var(--u)*13);height:calc(var(--u)*13);color:var(--accent)}
.ilabel{font-weight:var(--w-bold);font-size:calc(var(--u)*5)}
.uiframe{width:100%;max-width:calc(var(--u)*130);height:calc(var(--u)*56);background:var(--surface);border-radius:var(--radius);overflow:hidden;display:flex;flex-direction:column;box-shadow:0 calc(var(--u)*2) calc(var(--u)*6) rgba(0,0,0,.28)}
.portrait .uiframe{height:calc(var(--u)*90)}
.uibar{flex:none;height:calc(var(--u)*4);display:flex;gap:calc(var(--u)*1);align-items:center;padding:0 calc(var(--u)*1.6);background:color-mix(in srgb,var(--text) 12%,var(--surface))}
.uibar i{width:calc(var(--u)*1.3);height:calc(var(--u)*1.3);border-radius:50%;background:color-mix(in srgb,var(--text) 35%,transparent)}
.uiview{flex:1;overflow:hidden;position:relative}
.uishot{display:block;width:100%}
.uimock{padding:calc(var(--u)*3);display:flex;flex-direction:column;gap:calc(var(--u)*2.4)}
.m-h{height:calc(var(--u)*6);width:55%;background:var(--accent);border-radius:var(--radius)}
.m-l{height:calc(var(--u)*2);width:80%;background:color-mix(in srgb,var(--on-surface) 28%,transparent);border-radius:99px}
.m-l.s{width:50%}
.m-row{display:flex;gap:calc(var(--u)*2.4)}
.m-card{flex:1;height:calc(var(--u)*14);background:color-mix(in srgb,var(--on-surface) 14%,transparent);border-radius:var(--radius)}
.m-card.tall{height:calc(var(--u)*24)}
.strap{display:flex;align-items:stretch;gap:calc(var(--u)*2);align-self:flex-start;text-align:left}
.strapbar{width:calc(var(--u)*1);background:var(--accent)}
.straptext{display:flex;flex-direction:column;gap:calc(var(--u)*.6);padding:calc(var(--u)*.6) 0}
.sname{font-weight:var(--w-bold);font-size:calc(var(--u)*6)}
.btn{display:inline-flex;padding:calc(var(--u)*3) calc(var(--u)*6.5);background:var(--accent);color:var(--on-accent);border-radius:var(--radius)}
.shape-chunky .btn,.shape-chunky .panel,.shape-chunky .icell,.shape-chunky .uiframe{box-shadow:calc(var(--u)*1) calc(var(--u)*1) 0 var(--text);border:calc(var(--u)*.4) solid var(--text)}
.btntxt{font-weight:var(--w-bold);font-size:calc(var(--u)*6)}
.logo{max-width:60%;max-height:calc(var(--u)*30);object-fit:contain}
.brandline{width:calc(var(--u)*18);height:calc(var(--u)*.8);background:var(--accent);border-radius:99px}
.c-lower-third .content{align-items:flex-start;text-align:left}
.c-logo-sting .content,.c-cta-card .content{align-items:center!important;text-align:center!important;justify-content:center!important}
`;
