# Terra Posta — ilustrações da carta Mesa de Imbondeiro (uma imagem por artigo).
import math, random, unicodedata, re, sys
from PIL import Image, ImageDraw, ImageFilter
S = 3; W, H = 640 * S, 480 * S
CREME=(246,234,214); CREME2=(238,222,196); BRANCO=(255,251,242); TERRA=(176,63,27); TERRA2=(143,48,19); CAST=(74,26,12); CAST2=(44,14,5)
OURO=(214,164,60); VERDE=(96,132,62); VERDE2=(60,92,40); PALMA=(206,104,28); AMBAR=(196,128,40); RUBI=(122,22,38); ROSE=(222,140,130); PALHA=(226,204,130)
def slug(s): s=unicodedata.normalize('NFD',s.lower()); s=''.join(c for c in s if unicodedata.category(c)!='Mn'); return re.sub(r'[^a-z0-9]+','-',s).strip('-')
def sh(c,f): return tuple(max(0,min(255,int(v*f))) for v in c)
def mix(a,b,t): return tuple(int(a[i]+(b[i]-a[i])*t) for i in range(3))
class Tela:
    def __init__(s, escuro=False, seed=1):
        s.escuro=escuro; s.bg = CAST2 if escuro else CREME; s.r=random.Random(seed)
        s.im=Image.new('RGB',(W,H),s.bg); s.d=ImageDraw.Draw(s.im,'RGBA')
        linha = (255,236,200,16) if escuro else (74,26,12,14)
        cx,cy=W//2,H//2
        for k in range(1,9):
            rr=k*95*S//1.6; s.d.ellipse([cx-rr,cy-rr,cx+rr,cy+rr],outline=linha,width=S)
        for a in range(0,360,15):   # marcas de registo
            x0=cx+math.cos(math.radians(a))*222*S; y0=cy+math.sin(math.radians(a))*222*S; x1=cx+math.cos(math.radians(a))*(230 if a%45 else 238)*S; y1=cy+math.sin(math.radians(a))*(230 if a%45 else 238)*S
            s.d.line([x0,y0,x1,y1],fill=(255,236,200,40) if escuro else (74,26,12,34),width=S)
    def el(s,cx,cy,rx,ry,fill,outline=None,w=0): s.d.ellipse([(cx-rx)*S,(cy-ry)*S,(cx+rx)*S,(cy+ry)*S],fill=fill,outline=outline,width=w*S)
    def poly(s,pts,fill,outline=None,w=0): s.d.polygon([(x*S,y*S) for x,y in pts],fill=fill,outline=outline, width=w*S)
    def line(s,pts,fill,w=2): s.d.line([(x*S,y*S) for x,y in pts],fill=fill,width=w*S,joint='curve')
    def rr(s,x0,y0,x1,y1,r,fill,outline=None,w=0): s.d.rounded_rectangle([x0*S,y0*S,x1*S,y1*S],radius=r*S,fill=fill,outline=outline,width=w*S)
    def sombra(s,cx,cy,rx,ry): s.el(cx+10,cy+14,rx,ry,(0,0,0,70) if s.escuro else (74,26,12,46))
    # ---------- louça ----------
    def prato(s,cx=320,cy=240,r=176,cor=BRANCO):
        s.sombra(cx,cy,r,r); s.el(cx,cy,r,r,cor); s.el(cx,cy,r-4,r-4,None,sh(cor,.9),2); s.el(cx,cy,r*0.72,r*0.72,sh(cor,.965)); s.el(cx,cy,r*0.72,r*0.72,None,sh(cor,.88),2)
    def tigela(s,cx,cy,r,liquido,cor=TERRA):
        s.sombra(cx,cy,r,r); s.el(cx,cy,r,r,cor); s.el(cx,cy,r-6,r-6,None,sh(cor,1.25),2); s.el(cx,cy,r*0.82,r*0.82,sh(liquido,.82)); s.el(cx,cy+3,r*0.78,r*0.78,liquido)
    # ---------- comida ----------
    def monte(s,cx,cy,r,cor,grao=None,n=70):
        s.el(cx+4,cy+6,r,r*0.92,sh(cor,.8)); s.el(cx,cy,r,r*0.92,cor); s.el(cx-r*0.25,cy-r*0.28,r*0.5,r*0.4,sh(cor,1.07))
        if grao:
            for _ in range(n):
                a=s.r.random()*6.283; d=s.r.random()**.6*r*0.86; s.el(cx+math.cos(a)*d,cy+math.sin(a)*d*0.92,3.2,2.2,grao)
    def graos(s,cx,cy,rx,ry,cor,n=60,t=5):
        for _ in range(n):
            a=s.r.random()*6.283; d=s.r.random()**.5; x=cx+math.cos(a)*d*rx; y=cy+math.sin(a)*d*ry; s.el(x+1.5,y+2,t,t*0.68,sh(cor,.7)); s.el(x,y,t,t*0.68,cor); s.el(x-t*0.3,y-t*0.25,t*0.3,t*0.2,sh(cor,1.4))
    def rodelas(s,cx,cy,r,a0,a1,n,cor,raio=17,miolo=None):
        for i in range(n):
            a=math.radians(a0+(a1-a0)*i/max(1,n-1)); x=cx+math.cos(a)*r; y=cy+math.sin(a)*r
            s.el(x+2,y+3,raio,raio,sh(cor,.75)); s.el(x,y,raio,raio,cor); s.el(x,y,raio*0.72,raio*0.72,None,sh(cor,.88),1)
            if miolo: s.el(x,y,raio*0.3,raio*0.3,miolo)
    def peixe(s,cx,cy,L,ang,cor=(150,96,60)):
        ca,sa=math.cos(math.radians(ang)),math.sin(math.radians(ang)); P=lambda u,v:(cx+u*ca-v*sa, cy+u*sa+v*ca)
        corpo=[P(L*0.5*math.cos(t)-L*0.08, L*0.17*math.sin(t)) for t in [i*6.283/40 for i in range(40)]]
        cauda=[P(-L*0.5,0),P(-L*0.72,-L*0.15),P(-L*0.66,0),P(-L*0.72,L*0.15)]
        s.poly([(x+4,y+6) for x,y in corpo+[]],sh(cor,.6)); s.poly(cauda,sh(cor,.8)); s.poly(corpo,cor)
        for k in range(-3,4): s.line([P(k*L*0.09-L*0.06,-L*0.12),P(k*L*0.09-L*0.11,L*0.12)],sh(cor,.55),3)
        s.el(*P(L*0.3,-L*0.03),4,4,CAST2)
    def bife(s,cx,cy,rx,ry,cor=(112,54,30)):
        pts=[(cx+math.cos(t)*rx*(1+0.07*math.sin(3*t)), cy+math.sin(t)*ry*(1+0.09*math.cos(2*t))) for t in [i*6.283/48 for i in range(48)]]
        s.poly([(x+5,y+7) for x,y in pts],sh(cor,.6)); s.poly(pts,cor)
        for k in range(-3,4): s.line([(cx+k*rx*0.24-rx*0.3,cy-ry*0.55),(cx+k*rx*0.24+rx*0.3,cy+ry*0.55)],sh(cor,.62),4)
    def palitos(s,cx,cy,n=13,cor=(232,180,70)):
        for i in range(n):
            a=s.r.uniform(-65,65); x=cx+s.r.uniform(-34,34); y=cy+s.r.uniform(-30,30); l=s.r.uniform(40,58); dx=math.cos(math.radians(a))*l/2; dy=math.sin(math.radians(a))*l/2
            s.line([(x-dx+2,y-dy+3),(x+dx+2,y+dy+3)],sh(cor,.72),9); s.line([(x-dx,y-dy),(x+dx,y+dy)],cor,9); s.line([(x-dx,y-dy-2),(x+dx,y+dy-2)],sh(cor,1.15),2)
    def ovo(s,cx,cy,r=34):
        pts=[(cx+math.cos(t)*r*(1+0.12*math.sin(3*t+1)), cy+math.sin(t)*r*(1+0.1*math.cos(2*t))) for t in [i*6.283/40 for i in range(40)]]
        s.poly([(x+3,y+4) for x,y in pts],(210,200,180)); s.poly(pts,(255,253,246)); s.el(cx+2,cy,r*0.4,r*0.4,(238,160,36)); s.el(cx-3,cy-5,r*0.13,r*0.1,(255,214,120))
    def folhas(s,cx,cy,n=3,cor=VERDE,t=13):
        for i in range(n):
            a=s.r.uniform(0,360); x=cx+s.r.uniform(-12,12); y=cy+s.r.uniform(-12,12); ca,sa=math.cos(math.radians(a)),math.sin(math.radians(a))
            pts=[(x+ca*t*math.cos(q)-sa*t*0.45*math.sin(q), y+sa*t*math.cos(q)+ca*t*0.45*math.sin(q)) for q in [k*6.283/16 for k in range(16)]]; s.poly(pts,cor); s.line([(x-ca*t,y-sa*t),(x+ca*t,y+sa*t)],sh(cor,.7),1)
    def triangulos(s,cx,cy,n=4,cor=(214,150,58)):
        for i in range(n):
            a=math.radians(i*360/n+20); x=cx+math.cos(a)*62; y=cy+math.sin(a)*62; q=math.degrees(a)+90
            pts=[(x+math.cos(math.radians(q+k))*46, y+math.sin(math.radians(q+k))*46) for k in (0,120,240)]
            s.poly([(px+3,py+5) for px,py in pts],sh(cor,.62)); s.poly(pts,cor); s.poly([(x+(px-x)*.62,y+(py-y)*.62) for px,py in pts],None,sh(cor,.8),2)
    def cupula(s,cx,cy,r,cor,topo=None):
        s.el(cx+4,cy+6,r,r,sh(cor,.72)); s.el(cx,cy,r,r,cor); s.el(cx,cy,r*0.7,r*0.7,None,sh(cor,.9),2); s.el(cx-r*0.3,cy-r*0.32,r*0.28,r*0.2,sh(cor,1.12))
        if topo: s.graos(cx,cy,r*0.5,r*0.5,topo,26,2.6)
    def fio(s,cx,cy,r,cor,voltas=1.6):
        pts=[(cx+math.cos(t)*(r+10*math.sin(5*t)), cy+math.sin(t)*(r+10*math.sin(5*t))) for t in [i*voltas*6.283/90 for i in range(90)]]; s.line(pts,cor,3)
    # ---------- vidro (vista de frente) ----------
    def mesa(s,y=392): s.line([(120,y),(520,y)],(255,236,200,60) if s.escuro else (74,26,12,50),1); s.el(320,y+2,150,9,(0,0,0,60) if s.escuro else (74,26,12,34))
    def vidro(s): return (255,244,224,54) if s.escuro else (255,255,255,150)
    def contorno(s): return (255,236,200,170) if s.escuro else (74,26,12,150)
    def copo_alto(s,cx,base,w,h,liq,nivel=.78,gelo=0,espuma=0,fruta=None,hortela=False,afunila=.82):
        tl,tr,bl,br=(cx-w/2,base-h),(cx+w/2,base-h),(cx-w/2*afunila,base),(cx+w/2*afunila,base)
        s.poly([tl,tr,br,bl],s.vidro()); yl=base-h*nivel; f=1-(1-afunila)*(nivel)
        s.poly([(cx-w/2*(afunila+(1-afunila)*nivel),yl),(cx+w/2*(afunila+(1-afunila)*nivel),yl),br,bl],liq)
        for i in range(gelo):
            x=cx+s.r.uniform(-w*0.26,w*0.26); y=yl+12+i*h*nivel*0.2; a=s.r.uniform(-20,20); q=w*0.2
            pts=[(x+math.cos(math.radians(a+k))*q, y+math.sin(math.radians(a+k))*q) for k in (45,135,225,315)]; s.poly(pts,(255,255,255,90),(255,255,255,150),1)
        if hortela: s.folhas(cx-4,yl+h*nivel*0.45,5,VERDE,10); s.folhas(cx+6,yl+6,3,VERDE2,11)
        if espuma: s.rr(cx-w/2-3,yl-espuma,cx+w/2+3,yl+6,10,(255,250,236)); [s.el(cx+s.r.uniform(-w*0.4,w*0.4),yl-espuma*0.5+s.r.uniform(-6,6),5,5,(244,232,206)) for _ in range(9)]
        s.poly([tl,tr,br,bl],None,s.contorno(),2); s.line([(cx-w*0.33,base-h+16),(cx-w*0.33*afunila-2,base-18)],(255,255,255,120),3)
        if fruta: s.el(cx+w/2-2,base-h+2,22,22,fruta); s.el(cx+w/2-2,base-h+2,16,16,sh(fruta,1.25)); [s.line([(cx+w/2-2,base-h+2),(cx+w/2-2+math.cos(q)*16,base-h+2+math.sin(q)*16)],fruta,1) for q in [k*6.283/8 for k in range(8)]]
    def calice(s,cx,base,rb,hb,liq,nivel=.55,haste=92,bolhas=False,forma='tinto'):
        topo=base-haste-hb
        if forma=='flute': pts=[(cx-rb,topo),(cx+rb,topo),(cx+rb*0.78,topo+hb*0.7),(cx+4,base-haste),(cx-4,base-haste),(cx-rb*0.78,topo+hb*0.7)]
        elif forma=='coupe': pts=[(cx-rb,topo+hb*0.35),(cx+rb,topo+hb*0.35),(cx+4,base-haste),(cx-4,base-haste)]
        else: pts=[(cx-rb*0.8,topo)]+[(cx+math.cos(t)*rb, topo+hb*0.52+math.sin(t)*hb*0.5) for t in [math.pi+ i*math.pi/20*-1 for i in range(0)]]+[(cx-rb*0.8,topo),(cx+rb*0.8,topo)]+[(cx+rb*math.cos(t), topo+hb*0.45+hb*0.55*math.sin(t)) for t in [i*math.pi/24 for i in range(0,25)]]
        s.poly(pts,s.vidro())
        ys=[p[1] for p in pts]; y0,y1=min(ys),max(ys); yl=y1-(y1-y0)*nivel
        m=Image.new('L',(W,H),0); ImageDraw.Draw(m).polygon([(x*S,y*S) for x,y in pts],fill=255); ImageDraw.Draw(m).rectangle([0,0,W,yl*S],fill=0)
        s.im.paste(Image.new('RGB',(W,H),liq),(0,0),m); s.d=ImageDraw.Draw(s.im,'RGBA')
        if bolhas: [s.el(cx+s.r.uniform(-rb*0.5,rb*0.5),s.r.uniform(yl+6,y1-10),2.2,2.2,(255,255,255,170)) for _ in range(16)]
        s.poly(pts,None,s.contorno(),2); s.line([(cx,base-haste),(cx,base-6)],s.contorno(),3); s.el(cx,base-3,rb*0.62,6,s.vidro(),s.contorno(),2)
        if forma=='coupe': s.line([(cx-rb,topo+hb*0.35),(cx+rb,topo+hb*0.35)],(255,255,255,230),4)
        s.line([(cx-rb*0.55,y0+12),(cx-rb*0.5,y0+hb*0.42)],(255,255,255,110),3)
    def garrafa(s,cx,base,w,h,vidro,rotulo,capsula=None,ombro=.3):
        g=w*0.19; yo=base-h*0.66; yg=base-h*0.84
        corpo=[(cx-w/2,base),(cx-w/2,yo)]+[(cx-w/2+ (w/2-g)*(1-math.cos(t)), yo-(yo-yg)*math.sin(t)) for t in [i*1.5708/10 for i in range(11)]]+[(cx-g,base-h),(cx+g,base-h)]+[(cx+w/2-(w/2-g)*(1-math.cos(t)), yo-(yo-yg)*math.sin(t)) for t in [ (10-i)*1.5708/10 for i in range(11)]]+[(cx+w/2,yo),(cx+w/2,base)]
        s.poly([(x+7,y+3) for x,y in corpo],(0,0,0,60)); s.poly(corpo,vidro); s.line([(cx-w*0.3,yo+8),(cx-w*0.3,base-12)],sh(vidro,1.6)+(150,),4)
        s.rr(cx-w/2+1,base-h*0.5,cx+w/2-1,base-h*0.14,3,rotulo); s.line([(cx-w*0.26,base-h*0.4),(cx+w*0.26,base-h*0.4)],sh(rotulo,.6),2); s.line([(cx-w*0.18,base-h*0.33),(cx+w*0.18,base-h*0.33)],sh(rotulo,.72),1); s.el(cx,base-h*0.24,7,7,None,sh(rotulo,.6),2)
        if capsula: s.rr(cx-g-2,base-h-2,cx+g+2,base-h+h*0.13,3,capsula)
    def jarro(s,cx,base,w,h,liq,fruta=False):
        pts=[(cx-w*0.42,base),(cx-w*0.5,base-h*0.55),(cx-w*0.36,base-h),(cx+w*0.44,base-h),(cx+w*0.5,base-h*0.55),(cx+w*0.42,base)]
        s.d.arc([(cx+w*0.36)*S,(base-h*0.78)*S,(cx+w*0.86)*S,(base-h*0.18)*S],-80,80,fill=s.contorno(),width=7*S)
        s.poly(pts,s.vidro()); yl=base-h*0.74; s.poly([(cx-w*0.44,yl),(cx+w*0.47,yl),(cx+w*0.5,base-h*0.55),(cx+w*0.42,base),(cx-w*0.42,base),(cx-w*0.5,base-h*0.55)],liq)
        if fruta: s.rodelas(cx,base-h*0.4,34,200,340,3,(236,150,40),15,(250,200,90)); s.rodelas(cx+6,base-h*0.22,20,20,160,2,(206,60,50),11)
        s.poly(pts,None,s.contorno(),2); s.poly([(cx-w*0.36,base-h),(cx-w*0.52,base-h-8),(cx-w*0.3,base-h+10)],s.vidro(),s.contorno(),2); s.line([(cx-w*0.34,base-h+20),(cx-w*0.4,base-h*0.5)],(255,255,255,120),3)
    def chavena(s,cx=320,cy=240):
        s.sombra(cx,cy,150,150); s.el(cx,cy,150,150,BRANCO); s.el(cx,cy,146,146,None,sh(BRANCO,.9),2); s.el(cx,cy,104,104,sh(BRANCO,.95)); s.rr(cx+70,cy-16,cx+150,cy+16,16,BRANCO,sh(BRANCO,.86),2)
        s.el(cx+3,cy+5,88,88,sh(BRANCO,.82)); s.el(cx,cy,88,88,BRANCO); s.el(cx,cy,74,74,(58,28,14)); s.el(cx,cy,74,74,None,(120,70,36),5); s.el(cx-16,cy-18,26,16,(112,62,30)); s.rr(cx-128,cy+84,cx-58,cy+96,6,(200,190,170)); s.el(cx-128,cy+90,13,9,(200,190,170))
    def salva(s,nome):
        im=s.im.resize((640,480),Image.LANCZOS).quantize(colors=96,method=Image.MEDIANCUT,dither=Image.NONE)
        im.save(f'/home/claude/mesadeimbondeiro/public/img/{slug(nome)}.png',optimize=True)

def prato_base(seed,escuro=False):
    t=Tela(escuro,seed); t.prato(); return t
def copo(seed): t=Tela(True,seed); t.mesa(); return t
ITENS={}
def item(nome):
    def d(f): ITENS[nome]=f; return f
    return d
@item('Mufete')
def _(t=None):
    t=prato_base(11); t.graos(250,300,58,40,(96,40,22),70,6); t.rodelas(320,240,112,-70,10,5,(232,190,84),19,(246,214,120)); t.rodelas(330,250,118,35,95,3,(250,244,228),21); t.peixe(322,214,214,-18,(156,98,58)); t.folhas(404,300,3); t.el(238,186,13,13,(214,60,40)); return t
@item('Moamba de galinha')
def _():
    t=Tela(False,12); t.tigela(280,246,150,(204,96,30)); [t.monte(280+dx,246+dy,34,(176,104,52)) for dx,dy in ((-44,-30),(36,-44),(8,36),(-58,40))]; t.rodelas(280,246,84,10,120,4,VERDE,11,(214,226,170)); [t.el(280+t.r.uniform(-100,100),246+t.r.uniform(-100,100),4,4,(240,170,60,200)) for _ in range(40)]
    t.sombra(486,330,74,74); t.el(486,330,74,74,BRANCO); t.el(486,330,58,58,sh(BRANCO,.95)); t.cupula(486,326,44,(250,246,234)); return t
@item('Calulu de peixe')
def _():
    t=Tela(False,13); t.tigela(300,240,160,(150,112,40),(112,48,26)); [t.monte(300+dx,240+dy,30,(226,206,170)) for dx,dy in ((-50,-34),(46,-30),(-6,44))]; t.rodelas(300,240,98,0,300,9,VERDE,12,(226,236,190)); t.folhas(300,238,7,VERDE2,15); [t.el(300+t.r.uniform(-110,110),240+t.r.uniform(-110,110),4,4,(232,150,40,200)) for _ in range(36)]
    t.sombra(500,340,62,62); t.el(500,340,62,62,BRANCO); t.cupula(500,338,40,(250,246,234)); return t
@item('Bife à casa')
def _():
    t=prato_base(14); t.palitos(396,280); t.bife(264,236,92,62); t.ovo(318,178); t.folhas(240,322,4); return t
@item('Kitaba')
def _():
    t=Tela(False,15); t.tigela(320,240,128,(196,150,96)); t.fio(320,240,56,(170,122,70),2.2); t.graos(320,240,70,70,(150,92,48),22,6); t.el(320,240,9,9,(204,52,36)); t.graos(498,352,34,22,(176,112,60),10,7); t.graos(142,132,26,18,(176,112,60),7,7); return t
@item('Chamuças de carne')
def _():
    t=prato_base(16); t.triangulos(320,240); t.sombra(320,240,26,26); t.el(320,240,26,26,BRANCO,sh(BRANCO,.85),2); t.el(320,240,19,19,(188,60,34)); t.folhas(436,330,3); return t
@item('Cocada amarela')
def _():
    t=Tela(False,17); t.prato(320,240,150); t.cupula(320,236,70,(236,186,62),(150,84,36)); t.fio(320,240,96,(196,128,40),1.0); t.line([(392,170),(430,132)],(150,84,36),6); return t
@item('Mousse de múcua')
def _():
    t=Tela(False,18); t.prato(320,240,150); t.sombra(320,240,84,84); t.el(320,240,84,84,(228,214,196)); t.el(320,240,72,72,(250,244,232)); t.fio(320,240,34,(236,226,206),2.6); t.graos(320,240,40,40,(176,112,60),9,4); t.folhas(356,206,2,VERDE,12); return t
@item('Café')
def _(): t=Tela(False,19); t.chavena(); return t
@item('Água 0,5 L')
def _(): t=Tela(False,20); t.mesa(); t.garrafa(280,392,74,290,(190,222,236),(246,250,252),(80,150,200)); t.copo_alto(410,392,78,120,(210,234,244,170),.7); return t
@item('Refrigerante')
def _(): t=Tela(False,21); t.mesa(); t.copo_alto(320,392,118,236,(70,32,18),.82,gelo=3,fruta=(236,196,60)); t.line([(352,150),(338,380)],(214,60,40),6); return t
@item('Sumo natural de múcua')
def _(): t=Tela(False,22); t.mesa(); t.copo_alto(320,392,118,236,(244,228,196),.84,gelo=2); t.line([(350,146),(334,380)],VERDE,6); t.graos(470,378,26,10,(176,112,60),6,7); return t
def vinho(nome,seed,vid,rot,cap,liq,forma='tinto'):
    @item(nome)
    def _(): t=copo(seed); t.garrafa(258,392,82,312,vid,rot,cap); t.calice(416,392,56,112,liq,.5,forma=forma,bolhas=forma=='flute'); return t
vinho('Tinto da casa (garrafa)',31,(34,46,30),CREME,TERRA,RUBI); vinho('Douro tinto reserva (garrafa)',32,(24,30,24),(26,22,20),OURO,(104,16,32)); vinho('Dão tinto (garrafa)',33,(30,44,34),(240,226,200),CAST,(128,26,44)); vinho('Pinotage sul-africano (garrafa)',34,(36,40,28),TERRA,(20,20,20),(112,18,40))
vinho('Branco da casa (garrafa)',35,(120,134,70),CREME,OURO,PALHA); vinho('Vinho verde (garrafa)',36,(96,142,84),(250,250,240),VERDE,(226,224,150)); vinho('Alvarinho (garrafa)',37,(110,126,60),(250,246,230),OURO,(232,210,120)); vinho('Rosé (garrafa)',38,(232,176,160),(255,250,244),(210,120,110),ROSE)
vinho('Espumante bruto (garrafa)',39,(30,44,30),(20,20,20),OURO,(236,214,130),'flute'); vinho('Champanhe (garrafa)',40,(26,38,26),OURO,OURO,(240,220,140),'flute')
def so_calice(nome,seed,liq,forma='tinto'):
    @item(nome)
    def _(): t=copo(seed); t.calice(320,392,72,142,liq,.5,haste=104,forma=forma,bolhas=forma=='flute'); return t
so_calice('Tinto da casa (copo)',41,RUBI); so_calice('Vinho da casa (copo)',42,(128,26,44)); so_calice('Branco da casa (copo)',43,PALHA); so_calice('Espumante (copo)',44,(236,214,130),'flute')
@item('Tinto da casa (jarro)')
def _(): t=copo(45); t.jarro(290,392,150,230,RUBI); t.calice(450,392,44,86,RUBI,.5,haste=70); return t
@item('Sangria tinta (jarro)')
def _(): t=copo(46); t.jarro(290,392,160,240,(150,26,40),True); t.copo_alto(458,392,70,104,(150,26,40),.75,gelo=1); return t
@item('Cerveja nacional')
def _(): t=copo(47); t.garrafa(262,392,70,270,(110,62,22),CREME,OURO); t.copo_alto(404,392,92,206,AMBAR,.74,espuma=30); return t
@item('Cerveja importada')
def _(): t=copo(48); t.garrafa(262,392,70,270,(46,92,50),(250,250,244),(196,60,40)); t.copo_alto(404,392,92,206,(222,164,50),.74,espuma=30); return t
@item('Cerveja de pressão (fino)')
def _(): t=copo(49); t.copo_alto(320,392,104,250,(226,170,54),.8,espuma=36,afunila=.7); return t
@item('Cerveja preta')
def _(): t=copo(50); t.copo_alto(320,392,116,236,(40,22,14),.8,espuma=34); return t
def dose(nome,seed,liq,gelo=2,w=132,h=128,nivel=.5):
    @item(nome)
    def _(): t=copo(seed); t.copo_alto(320,392,w,h,liq,nivel,gelo=gelo,afunila=.9); return t
dose('Whisky novo (dose)',51,(206,140,40)); dose('Whisky 12 anos (dose)',52,(176,104,30)); dose('Rum (dose)',53,(140,74,30),0); dose('Vodka (dose)',54,(226,236,240,150),1,96,150,.4); dose('Licor (dose)',56,(150,40,36),0,84,112,.6)
@item('Aguardente velha (dose)')
def _(): t=copo(55); t.calice(320,392,84,120,(190,116,36),.34,haste=46); return t
@item('Gin tónico')
def _(): t=copo(57); t.calice(320,392,92,150,(214,232,226),.66,haste=84); t.rodelas(320,236,0,0,0,1,(170,200,90),30,(214,230,150)); t.folhas(356,214,2,VERDE,12); [t.el(320+t.r.uniform(-50,50),t.r.uniform(214,280),4,4,(255,255,255,150)) for _ in range(12)]; return t
@item('Caipirinha')
def _(): t=copo(58); t.copo_alto(320,392,140,150,(206,220,150),.78,gelo=3,afunila=.92,fruta=(120,170,60)); t.rodelas(304,340,26,160,380,3,(120,170,60),13,(214,230,150)); return t
@item('Mojito')
def _(): t=copo(59); t.copo_alto(320,392,112,236,(206,230,196),.84,gelo=3,hortela=True,fruta=(120,170,60)); t.line([(350,146),(334,380)],CREME,6); return t
@item('Margarita')
def _(): t=copo(60); t.calice(320,392,104,96,(216,226,150),.86,haste=128,forma='coupe'); t.el(410,268,22,22,(120,170,60)); t.el(410,268,16,16,(214,230,150)); return t
# genéricos para artigos novos sem imagem
@item('_prato')
def _(): t=prato_base(90); t.monte(286,226,62,(250,246,234),(236,226,204),90); t.bife(376,270,60,44,(150,84,44)); t.folhas(300,318,4); return t
@item('_bebida')
def _(): t=copo(91); t.copo_alto(320,392,112,220,AMBAR,.78,gelo=3,fruta=(236,196,60)); return t
if __name__=='__main__':
    for n,f in ITENS.items(): f().salva(n)
    print(len(ITENS),'imagens')
