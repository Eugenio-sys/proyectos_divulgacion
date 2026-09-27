/* MathJax 4.1.3. All extensions and glyph data are served from this site. */
(() => {
  'use strict';
  const root = new URL('../vendor/mathjax/', document.currentScript.src).href.replace(/\/$/, '');
  const extensions = ['ams','amscd','newcommand','configmacros','textmacros','textcomp',
    'mathtools','boldsymbol','dsfont','bbm','bbox','color','cancel','cases','empheq',
    'extpfeil','upgreek','braket','centernot','gensymb','colortbl','enclose','verb'];
  const macros = {bm:['\\boldsymbol{#1}',1]};
  const esint = {int:1,iint:3,iiint:5,iiiint:7,dotsint:9,idotsint:9,oint:11,
    oiint:13,sqint:15,sqiint:17,ointctrclockwise:23,ointclockwise:25,
    varointclockwise:27,varointctrclockwise:29,fint:31,varoiint:33,
    landupint:35,landdownint:37};
  for (const [command,code] of Object.entries(esint)) {
    const glyph=String.fromCodePoint(0xE100+code);
    macros[command]=`\\mathop{\\mathchoice{\\constanciasesintd{${glyph}}}{\\constanciasesintt{${glyph}}}{\\constanciasesintt{${glyph}}}{\\constanciasesintt{${glyph}}}}\\nolimits`;
  }
  const ding = {"32":" ","33":"✁","34":"✂","35":"✃","36":"✄","37":"☎","38":"✆","39":"✇","40":"✈","41":"✉","42":"☛","43":"☞","44":"✌","45":"✍","46":"✎","47":"✏","48":"✐","49":"✑","50":"✒","51":"✓","52":"✔","53":"✕","54":"✖","55":"✗","56":"✘","57":"✙","58":"✚","59":"✛","60":"✜","61":"✝","62":"✞","63":"✟","64":"✠","65":"✡","66":"✢","67":"✣","68":"✤","69":"✥","70":"✦","71":"✧","72":"★","73":"✩","74":"✪","75":"✫","76":"✬","77":"✭","78":"✮","79":"✯","80":"✰","81":"✱","82":"✲","83":"✳","84":"✴","85":"✵","86":"✶","87":"✷","88":"✸","89":"✹","90":"✺","91":"✻","92":"✼","93":"✽","94":"✾","95":"✿","96":"❀","97":"❁","98":"❂","99":"❃","100":"❄","101":"❅","102":"❆","103":"❇","104":"❈","105":"❉","106":"❊","107":"❋","108":"●","109":"❍","110":"■","111":"❏","112":"❐","113":"❑","114":"❒","115":"▲","116":"▼","117":"◆","118":"❖","119":"◗","120":"❘","121":"❙","122":"❚","123":"❛","124":"❜","125":"❝","126":"❞","128":"❨","129":"❩","130":"❪","131":"❫","132":"❬","133":"❭","134":"❮","135":"❯","136":"❰","137":"❱","138":"❲","139":"❳","140":"❴","141":"❵","161":"❡","162":"❢","163":"❣","164":"❤","165":"❥","166":"❦","167":"❧","168":"♣","169":"♦","170":"♥","171":"♠","172":"①","173":"②","174":"③","175":"④","176":"⑤","177":"⑥","178":"⑦","179":"⑧","180":"⑨","181":"⑩","182":"❶","183":"❷","184":"❸","185":"❹","186":"❺","187":"❻","188":"❼","189":"❽","190":"❾","191":"❿","192":"➀","193":"➁","194":"➂","195":"➃","196":"➄","197":"➅","198":"➆","199":"➇","200":"➈","201":"➉","202":"➊","203":"➋","204":"➌","205":"➍","206":"➎","207":"➏","208":"➐","209":"➑","210":"➒","211":"➓","212":"➔","213":"→","214":"↔","215":"↕","216":"➘","217":"➙","218":"➚","219":"➛","220":"➜","221":"➝","222":"➞","223":"➟","224":"➠","225":"➡","226":"➢","227":"➣","228":"➤","229":"➥","230":"➦","231":"➧","232":"➨","233":"➩","234":"➪","235":"➫","236":"➬","237":"➭","238":"➮","239":"➯","241":"➱","242":"➲","243":"➳","244":"➴","245":"➵","246":"➶","247":"➷","248":"➸","249":"➹","250":"➺","251":"➻","252":"➼","253":"➽","254":"➾"};
  window.MathJax = {
    loader: {
      paths: {mathjax:root, fonts:root+'/fonts'},
      load: extensions.filter(name=>!['ams','newcommand','configmacros','textmacros'].includes(name)).map(name=>'[tex]/'+name)
    },
    startup: {
      typeset:false,
      ready() {
        const tex=MathJax._.input.tex;
        const {Configuration}=tex.Configuration;
        const {CommandMap}=tex.TokenMap;
        const {default:BaseMethods}=tex.base.BaseMethods;
        const {default:TexError}=tex.TexError;
        new CommandMap('constancias-symbols', {
          mathscr(parser,name) {
            const position=parser.i, argument=parser.GetArgument(name);
            if(!/^[A-Z\s]*$/.test(argument)) throw new TexError('InvalidRSFS','\\mathscr admite las mayúsculas A–Z de RSFS. Coloca subíndices y otros símbolos fuera de sus llaves.');
            parser.i=position;
            BaseMethods.MathFont(parser,name,'-constancias-rsfs');
          },
          constanciasesintt(parser,name) {BaseMethods.MathFont(parser,name,'-constancias-esint-text');},
          constanciasesintd(parser,name) {BaseMethods.MathFont(parser,name,'-constancias-esint-display');},
          ding(parser,name) {
            const value=parser.GetArgument(name).trim();
            if(!/^\d+$/.test(value)||!Object.hasOwn(ding,Number(value))) {
              throw new TexError('InvalidDing','El código de \\ding{%1} no existe en ZapfDingbats.',value);
            }
            parser.Push(parser.create('token','mo',{mathvariant:'-constancias-ding',stretchy:false},String.fromCodePoint(0xE200+Number(value))));
          }
        });
        Configuration.create('constancias-symbols',{handler:{macro:['constancias-symbols']}});
        MathJax.startup.defaultReady();
        const output=MathJax.startup.document.outputJax;
        output.addExtension({
          name:'constancias-symbols',
          variants:{'[+]':[['-constancias-rsfs','normal'],['-constancias-esint-text','normal'],['-constancias-esint-display','normal'],['-constancias-ding','normal']]},
          cacheIds:{'-constancias-rsfs':'CRSFS','-constancias-esint-text':'CET','-constancias-esint-display':'CED','-constancias-ding':'CDING'},
          chars:window.ConstanciasMathFontData
        });
      }
    },
    output:{font:'mathjax-newcm',fontPath:root+'/fonts/%%FONT%%-font',displayOverflow:'overflow',linebreaks:{inline:false}},
    svg:{fontCache:'none'},
    options:{enableMenu:false,enableEnrichment:false,enableSpeech:false,enableBraille:false,enableExplorer:false,enableComplexity:false,menuOptions:{settings:{enrich:false,speech:false,braille:false,collapsible:false,assistiveMml:false}}},
    tex:{
      packages:{'[+]':[...extensions,'constancias-symbols'],'[-]':['noundefined','require','autoload']},
      macros,
      textmacros:{packages:['text-base','textcomp']},
      maxBuffer:30000,
      maxMacros:5000,
      tags:'none'
    }
  };
})();
