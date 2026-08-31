const SURL='https://jkantpfxudbqzrtrctgp.supabase.co'
const SKEY='sb_publishable_DeHWabj6Oh13qkMB7KzNfQ_5e6ZW9Fm'
const ADMIN_FN_URL=SURL+'/functions/v1/admin-users'
const {createClient}=supabase
// Sessao guardada em sessionStorage (nao localStorage): sobrevive a atualizar a pagina/aba
// (nao precisa logar de novo o tempo todo), mas MORRE ao fechar o navegador de verdade.
// Isso evita que quem sentar depois no mesmo computador entre direto sem senha, so digitando o endereco.
const db=createClient(SURL,SKEY,{auth:{storage:window.sessionStorage,persistSession:true,autoRefreshToken:true}})

let prods=[],cart=[],cartSnapshot=[],catA='Todos',promos=[],userLogado=null,payMetodo=null
let excecoes=[]
const INACTIVITY_LIMIT_MS=30*60*1000
let inactivityTimer=null
let logoutEmAndamento=false

// Multi-tenant: cliente_id do usuario logado, pra nunca uma loja ver dado de outra loja.
// Master (superadmin) nao tem cliente_id — visao dele fica sem filtro de proposito, pra
// conseguir conferir/testar qualquer loja. Todo mundo com cliente_id fica travado no proprio.
function meuCid(){ return (userLogado&&userLogado.cliente_id)||null }
function scopeCid(q){
  if(userLogado&&userLogado.nivel!=='superadmin'&&userLogado.cliente_id){
    return q.eq('cliente_id',userLogado.cliente_id)
  }
  return q
}

// Imprime um HTML sem abrir uma janela separada que fica flutuando/sobrepondo a tela.
// Usa um iframe escondido: so aparece mesmo a caixinha nativa de impressao do navegador.
function imprimirViaIframe(html){
  var iframe=document.createElement('iframe')
  iframe.style.position='fixed'
  iframe.style.right='0'
  iframe.style.bottom='0'
  iframe.style.width='0'
  iframe.style.height='0'
  iframe.style.border='0'
  iframe.style.visibility='hidden'
  document.body.appendChild(iframe)
  var doc=iframe.contentWindow.document
  doc.open();doc.write(html);doc.close()
  function limpar(){ if(iframe&&iframe.parentNode) iframe.parentNode.removeChild(iframe) }
  iframe.contentWindow.onafterprint=limpar
  setTimeout(function(){
    try{
      iframe.contentWindow.focus()
      iframe.contentWindow.print()
    }catch(e){}
    // seguranca: se o navegador nao disparar onafterprint, remove sozinho depois de um tempo
    setTimeout(limpar,15000)
  },350)
}

// Recibos para o cliente: mesmo esquema do cartaz A4 — abre uma janela de verdade com
// preview visivel + barra "Imprimir agora"/"Fechar", pra quem esta no caixa decidir se imprime.
// Nao dispara .print() sozinho (diferente do imprimirViaIframe, que e so pra cupom de cozinha/relatorios).
function imprimirComPreview(html,tituloBarra){
  // Chrome da janela de preview no mesmo padrao visual do resto do app (cores, fonte, botoes) —
  // so o CONTEUDO do papel/cupom continua branco/preto de proposito, pra imprimir igual numa impressora de verdade.
  var toolbar='<div class="no-print preview-toolbar">'+
    '<div class="preview-heading"><span class="preview-icon">&#x1F5A8;</span><div><strong>'+(tituloBarra||'Pronto para imprimir')+'</strong><small>Confira os dados antes de continuar</small></div></div>'+
    '<div class="preview-actions">'+
      '<button type="button" class="preview-close" onclick="window.close()">Fechar</button>'+
      '<button type="button" class="preview-print" onclick="window.print()">Imprimir</button>'+
    '</div>'+
  '</div><div class="no-print preview-spacer"></div>'
  var fundoPreview='<style>'+
    '@media screen{'+
      'html{background:#0d0f14;padding:0 14px 28px}'+
      'body{box-shadow:0 12px 48px rgba(0,0,0,.55);margin-left:auto!important;margin-right:auto!important}'+
      '.preview-toolbar{position:fixed;top:0;left:0;right:0;min-height:64px;background:#13161e;padding:10px 18px;display:flex;align-items:center;justify-content:space-between;gap:14px;z-index:999;border-bottom:1px solid #2e3548;font-family:system-ui,-apple-system,sans-serif;box-shadow:0 4px 24px rgba(0,0,0,.4)}'+
      '.preview-heading{display:flex;align-items:center;gap:10px;color:#fff;min-width:0}.preview-heading strong{display:block;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.preview-heading small{display:block;color:#8991ac;font-size:11px;margin-top:2px}.preview-icon{font-size:20px}'+
      '.preview-actions{display:flex;gap:8px;flex-shrink:0}.preview-actions button{height:38px;padding:0 16px;border-radius:9px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit}'+
      '.preview-close{background:#222736;color:#fff;border:1px solid #3a4260}.preview-print{background:#3ecf8e;color:#0d0f14;border:1px solid #3ecf8e}'+
      '.preview-spacer{height:76px}'+
      '@media(max-width:460px){.preview-toolbar{align-items:stretch;flex-direction:column}.preview-actions button{flex:1}.preview-actions{width:100%}.preview-spacer{height:118px}}'+
    '}'+
    '@media print{.no-print{display:none!important}}'+
  '</style>'
  var htmlComToolbar=html
    .replace('<style>',fundoPreview+'<style>')
    .replace(/<body>/,'<body>'+toolbar)
  if(htmlComToolbar.indexOf('onafterprint')===-1){
    htmlComToolbar=htmlComToolbar.replace('</body>','<script>window.onafterprint=function(){window.close()}<\/script></body>')
  }
  var w=window.open('','_blank','width=520,height=820')
  w.document.write(htmlComToolbar)
  w.document.close()
}

// Registra uma excecao tanto na tela (memoria) quanto no banco (persistente, para o admin ver depois)
// itens (opcional): array com o pedido completo, ex: [{nome,qty,preco_final,preco_venda}]
async function registrarExcecao(acao,detalhe,valor,itens){
  var nomeUser=(userLogado&&userLogado.nome)||'Desconhecido'
  excecoes.unshift({dt:new Date().toLocaleString('pt-BR'),user:nomeUser,acao:acao,detalhe:detalhe,itens:itens||null})
  if(document.getElementById('sec-excecoes'))renderExceções()
  try{
    await db.from('excecoes').insert({usuario_nome:nomeUser,acao:acao,detalhe:detalhe,valor:valor||null,itens:itens||null,cliente_id:meuCid()})
  }catch(e){ /* nao bloquear o fluxo do usuario se o insert falhar */ }
}

async function carregarExcecoes(){
  var res=await scopeCid(db.from('excecoes').select('*')).order('criado_em',{ascending:false}).limit(200)
  if(res.data){
    excecoes=res.data.map(function(e){
      return{dt:new Date(e.criado_em).toLocaleString('pt-BR'),user:e.usuario_nome||'Desconhecido',acao:e.acao,detalhe:e.detalhe,itens:e.itens||null}
    })
  }
}
let _confirmCb=null

// Modal de confirmacao generico (substitui window.confirm)
function confirmDialog(msg,cb,opts){
  opts=opts||{}
  document.getElementById('cg-titulo').textContent=opts.titulo||'Confirmar exclusao?'
  document.getElementById('cg-msg').textContent=msg
  document.getElementById('cg-ic').textContent=opts.icone||'⚠️'
  var btn=document.getElementById('cg-btn-ok')
  btn.textContent=opts.okLabel||'\u{1F5D1} Excluir'
  btn.className='btn '+(opts.okClass||'red')
  _confirmCb=cb
  document.getElementById('ov-confirm-generico').classList.add('open')
}
function _execConfirmDialog(){
  var cb=_confirmCb
  _confirmCb=null
  closeModals()
  if(cb)cb()
}

const FUNCIONALIDADES=[
  {key:'pdv',label:'PDV',ic:'&#x1F6D2;'},
  {key:'estoque',label:'Estoque',ic:'&#x1F4E6;'},
  {key:'promocoes',label:'Promoções',ic:'&#x1F525;'},
  {key:'financeiro',label:'Financeiro',ic:'&#x1F4CA;'},
  {key:'relatorios',label:'Relatorios',ic:'&#x1F4CB;'},
  {key:'multiplos_caixas',label:'Multi-caixas',ic:'&#x1F5A5;'},
  {key:'impressao_cupom',label:'Impressao',ic:'&#x1F5A8;'},
  {key:'maquininha',label:'Maquininha',ic:'&#x1F4F1;'},
  {key:'whatsapp_alertas',label:'WhatsApp',ic:'&#x1F4AC;'},
  {key:'atendimento_mesas',label:'Atendimento Mesas',ic:'&#x1F37D;'}
]

// Permissoes por nivel
const PERMISSOES={
  superadmin:{editar:true,excluir:true,relatorios:true,excecoes:true},
  admin:{editar:true,excluir:true,relatorios:true,excecoes:true},
  gerente:{editar:false,excluir:false,relatorios:true,excecoes:false},
  operador:{editar:false,excluir:false,relatorios:false,excecoes:false}
}

function perm(acao){
  if(!userLogado)return false
  return PERMISSOES[userLogado.nivel]&&PERMISSOES[userLogado.nivel][acao]
}

// LOGIN
// Autenticacao real via Supabase Auth (antes era so uma tabela propria com senha em texto puro,
// o que nao dava pra proteger de verdade com RLS). A tabela usuarios continua existindo, mas so
// como "perfil" (nome, nivel, cliente_id) — quem confere a senha agora e o Supabase Auth.
async function carregarPerfilLogado(authUser){
  const{data,error}=await db.from('usuarios').select('*').eq('id',authUser.id).single()
  if(error||!data||!data.ativo)return null
  return data
}

function togglePassword(){
  const input=document.getElementById('login-senha')
  const btn=document.getElementById('password-toggle')
  const mostrar=input.type==='password'
  input.type=mostrar?'text':'password'
  btn.setAttribute('aria-pressed',String(mostrar))
  btn.setAttribute('aria-label',mostrar?'Ocultar senha':'Mostrar senha')
  btn.title=mostrar?'Ocultar senha':'Mostrar senha'
  input.focus()
}

async function doLogin(event){
  if(event)event.preventDefault()
  const email=document.getElementById('login-email').value.trim()
  const senha=document.getElementById('login-senha').value
  const btn=document.getElementById('btn-login-do')
  const err=document.getElementById('login-err')
  if(!email||!senha){err.textContent='Preencha email e senha';err.style.display='block';return}
  btn.textContent='Entrando...';btn.disabled=true;err.style.display='none'
  try{
    const{data:authData,error:authErr}=await db.auth.signInWithPassword({email:email,password:senha})
    if(authErr||!authData.user){err.textContent='Email ou senha incorretos';err.style.display='block';btn.textContent='Entrar no sistema';btn.disabled=false;return}
    const perfil=await carregarPerfilLogado(authData.user)
    if(!perfil){
      await db.auth.signOut()
      err.textContent='Usuario inativo ou nao encontrado';err.style.display='block';btn.textContent='Entrar no sistema';btn.disabled=false;return
    }
    // So guarda o EMAIL pra facilitar o proximo login (autopreenche o campo).
    // A senha nunca fica guardada em lugar nenhum do app.
    try{localStorage.setItem('ultimo_login_email',email)}catch(e){}
    userLogado=perfil;iniciarApp()
  }catch(e){err.textContent='Erro de conexao';err.style.display='block';btn.textContent='Entrar no sistema';btn.disabled=false}
}

// Restaura a sessao se a pessoa ja estava logada (Supabase Auth guarda a sessao sozinho) —
// evita ter que logar de novo toda vez que abre a aba/atualiza a pagina.
async function restaurarSessao(){
  try{
    const{data,error}=await db.auth.getUser()
    if(error||!data||!data.user)return
    const perfil=await carregarPerfilLogado(data.user)
    if(!perfil){await db.auth.signOut();return}
    userLogado=perfil;iniciarApp()
  }catch(e){}
}

function iniciarApp(){
  document.getElementById('login-wrap').style.display='none'
  document.getElementById('app').classList.add('on')
  document.getElementById('sf-avatar').textContent=userLogado.nome.charAt(0).toUpperCase()
  document.getElementById('sf-name').textContent=userLogado.nome
  document.getElementById('sf-nivel').textContent=userLogado.nivel==='superadmin'?'Master':userLogado.nivel
  // O painel que controla todas as lojas (antigo "Super Admin"/"Master 4to") nao tem mais
  // botao proprio no menu — so quem loga como superadmin ve e acessa clicando no proprio perfil.
  var sfUser=document.getElementById('sf-user')
  if(userLogado.nivel==='superadmin'){
    sfUser.style.cursor='pointer'
    sfUser.title='Painel Master'
    sfUser.onclick=function(){go('superadmin')}
  }else{
    sfUser.style.cursor='default'
    sfUser.title=''
    sfUser.onclick=null
  }
  ajustarMenuPorNivel()
  ajustarMenuPorFuncionalidades()
  loadProds();loadPromos()
  carregarCategorias().then(preencherSelectCategorias)
  tick();setInterval(tick,30000)
  restaurarRascunhoCart()
  iniciarMonitorInatividade()
  // Master nao vende nada, so administra as lojas — entao cai direto no Painel Master.
  // Todo mundo mais (dono da loja, gerente, operador) cai no PDV, que e o trabalho do dia a dia.
  if(userLogado.nivel==='superadmin')go('superadmin')
  else go('pdv',document.getElementById('nav-pdv'))
}

var funcsAtivas={}
async function ajustarMenuPorFuncionalidades(){
  var navMesas=document.getElementById('nav-mesas')
  var navKds=document.getElementById('nav-kds')
  // Superadmin (login master, sem cliente_id) sempre ve os modulos, pra poder testar/conferir qualquer coisa
  if(userLogado.nivel==='superadmin'){
    funcsAtivas={atendimento_mesas:true}
    if(navMesas)navMesas.style.display=''
    if(navKds)navKds.style.display=''
    return
  }
  if(!userLogado.cliente_id){if(navMesas)navMesas.style.display='none';if(navKds)navKds.style.display='none';return}
  try{
    var res=await db.from('funcionalidades').select('*').eq('cliente_id',userLogado.cliente_id).single()
    funcsAtivas=res.data||{}
  }catch(e){funcsAtivas={}}
  var mostrar=funcsAtivas.atendimento_mesas?'':'none'
  if(navMesas)navMesas.style.display=mostrar
  if(navKds)navKds.style.display=mostrar
}

function ajustarMenuPorNivel(){
  var nivel=userLogado.nivel
  // Operador: so PDV
  if(nivel==='operador'){
    ['grp-estoque','grp-fin','grp-gestao'].forEach(function(id){
      var el=document.getElementById(id);if(el)el.style.display='none'
    })
    var navPromos=document.getElementById('nav-promos');if(navPromos)navPromos.style.display='none'
  }
  // Gerente: sem gestao
  else if(nivel==='gerente'){
    var elg=document.getElementById('grp-gestao');if(elg)elg.style.display='none'
  }
  // Admin e Superadmin: gestao completa visivel (o painel Master, que so o superadmin tem,
  // nao fica mais no menu — acessa clicando no proprio perfil, ver iniciarApp())
}

function reiniciarInatividade(){
  if(!userLogado)return
  clearTimeout(inactivityTimer)
  inactivityTimer=setTimeout(function(){doLogout('Sua sessão foi encerrada após 30 minutos de inatividade.')},INACTIVITY_LIMIT_MS)
}

function iniciarMonitorInatividade(){
  reiniciarInatividade()
}

;['pointerdown','keydown','touchstart'].forEach(function(evento){
  document.addEventListener(evento,reiniciarInatividade,{passive:true})
})

async function doLogout(motivo){
  if(logoutEmAndamento)return
  logoutEmAndamento=true
  clearTimeout(inactivityTimer)
  try{await db.auth.signOut({scope:'local'})}catch(e){}
  userLogado=null;cart=[]
  document.getElementById('app').classList.remove('on')
  document.getElementById('login-wrap').style.display='flex'
  // Mantem so o email preenchido (facilita o proximo login); a senha some sempre.
  try{document.getElementById('login-email').value=localStorage.getItem('ultimo_login_email')||''}catch(e){document.getElementById('login-email').value=''}
  document.getElementById('login-senha').value=''
  document.getElementById('btn-login-do').textContent='Entrar no sistema'
  document.getElementById('btn-login-do').disabled=false
  var err=document.getElementById('login-err')
  err.textContent=typeof motivo==='string'?motivo:''
  err.style.display=typeof motivo==='string'?'block':'none'
  logoutEmAndamento=false
  document.getElementById('login-email').focus()
}

function tick(){
  var n=new Date()
  var el=document.getElementById('relogio')
  if(el)el.textContent=n.toLocaleDateString('pt-BR')+' - '+n.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})
}

// MENU CASCATA
function toggleGrp(id){
  var header=document.querySelector('#grp-'+id+' .nav-group-header')
  var items=document.getElementById('grp-'+id+'-items')
  if(!header||!items)return
  var isOpen=items.classList.contains('open')
  // Accordion: ao abrir um grupo, fecha os outros que estavam abertos.
  document.querySelectorAll('.nav-items.open').forEach(function(el){if(el!==items)el.classList.remove('open')})
  document.querySelectorAll('.nav-group-header.open').forEach(function(el){if(el!==header)el.classList.remove('open')})
  if(isOpen){items.classList.remove('open');header.classList.remove('open')}
  else{items.classList.add('open');header.classList.add('open')}
}

function go(id,el){
  if(id!=='comanda'&&comandaTimerInterval){clearInterval(comandaTimerInterval);comandaTimerInterval=null}
  if(id!=='comanda')mesaPagamentoAtivo=false
  document.querySelectorAll('.sec').forEach(function(s){s.classList.remove('on')})
  document.querySelectorAll('.nav-item').forEach(function(n){n.classList.remove('on')})
  var sec=document.getElementById('sec-'+id)
  if(sec)sec.classList.add('on')
  if(el)el.classList.add('on')
  if(id==='estoque')renderEstoque()
  if(id==='listacompras')renderListaCompras()
  if(id==='historicoreposicao')renderHistoricoReposicao()
  if(id==='categorias')renderCategorias()
  if(id==='fin')renderFin()
  if(id==='prods')renderProds()
  if(id==='users')renderUsers()
  if(id==='promos')renderPromos()
  if(id==='pagar')renderContasPagar()
  if(id==='receber')renderContasReceber()
  if(id==='superadmin')renderSuperAdmin()
  if(id==='clientes')renderClientesFiado()
  if(id==='relatorio')renderRelatorio()
  if(id==='excecoes')carregarExcecoes().then(renderExceções)
  if(id==='mesas')renderMesas()
  if(id==='kds')renderKds()
  if(id==='caixa')renderCaixa()
  // No celular, navegar fecha a gaveta do menu sozinho (senao fica cobrindo a tela nova)
  if(window.innerWidth<=768)fecharMobileSidebar()
}

// MODO MOBILE — gaveta do menu lateral
function toggleMobileSidebar(){
  document.querySelector('.sidebar').classList.toggle('mobile-open')
  document.getElementById('mobile-overlay').classList.toggle('on')
}
function fecharMobileSidebar(){
  document.querySelector('.sidebar').classList.remove('mobile-open')
  document.getElementById('mobile-overlay').classList.remove('on')
}

// MODO MOBILE — PDV: alterna entre a aba "Produtos" e a aba "Pedido" (lado a lado no desktop,
// uma tela de cada vez no celular). Fora do mobile essas classes nao tem efeito (ver CSS).
function pdvMobileTab(tab){
  var esq=document.getElementById('pdv-left')
  var carrinho=document.getElementById('pdv-cart')
  if(esq)esq.classList.toggle('mobile-hide',tab!=='produtos')
  if(carrinho)carrinho.classList.toggle('mobile-hide',tab!=='pedido')
  var btnProd=document.getElementById('pdv-tab-produtos')
  var btnPed=document.getElementById('pdv-tab-pedido')
  if(btnProd)btnProd.classList.toggle('on',tab==='produtos')
  if(btnPed)btnPed.classList.toggle('on',tab==='pedido')
}

// BARCODE
function toggleBarcode(){
  var area=document.getElementById('barcode-area')
  var input=document.getElementById('barcode-input')
  if(area.style.display==='none'){area.style.display='block';input.focus();toast('Leitor de codigo de barras ativado')}
  else{area.style.display='none'}
}

function barcodeEnter(e){
  if(e.key!=='Enter')return
  var code=document.getElementById('barcode-input').value.trim()
  if(!code)return
  var p=prods.find(function(x){return x.codigo_barras===code})
  if(p){addCart(p.id,Number(p.preco_venda));document.getElementById('barcode-input').value='';document.getElementById('barcode-input').focus()}
  else{toast('Produto nao encontrado: '+code,1)}
}

// PRODUTOS
async function loadProds(){
  var res=await scopeCid(db.from('produtos').select('*')).order('nome')
  prods=res.data||[]
  renderCats();renderPDV();updateBadge()
  document.getElementById('pdv-info').textContent=prods.length+' produtos'
}

async function loadPromos(){
  var res=await scopeCid(db.from('promocoes').select('*'))
  promos=res.data||[]
}

function renderCats(){
  var resto=[...new Set(prods.map(function(p){return p.categoria}).filter(Boolean))].sort(function(a,b){return a.localeCompare(b,'pt-BR')})
  var cats=['Todos'].concat(resto)
  document.getElementById('cat-filter').innerHTML=cats.map(function(c){
    return'<button class="cat-btn '+(c===catA?'on':'')+'" onclick="setcat(\''+c+'\')">'+c+'</button>'
  }).join('')
}

function setcat(c){catA=c;renderCats();renderPDV()}

function renderPDV(){
  var q=(document.getElementById('srch')||{}).value?document.getElementById('srch').value.toLowerCase():''
  var lista=prods.filter(function(p){return p.nome.toLowerCase().includes(q)||(p.codigo_barras||'').includes(q)})
  if(catA!=='Todos')lista=lista.filter(function(p){return p.categoria===catA})
  var g=document.getElementById('pgrid')
  if(!lista.length){g.innerHTML='<div class="empty" style="grid-column:1/-1">Nenhum produto</div>';return}
  var hoje=new Date().toISOString().slice(0,10)
  g.innerHTML=lista.map(function(p){
    var sem=p.estoque===0,baixo=p.estoque>0&&p.estoque<=p.estoque_minimo
    var promo=promos.find(function(x){return x.produto_id===p.id&&x.valido_ate>=hoje})
    var pf=Number(p.preco_venda),pb=''
    if(promo){
      if(promo.tipo==='percent'){pf=pf*(1-promo.valor/100);pb='<div class="promo-badge">-'+promo.valor+'%</div>'}
      else if(promo.tipo==='valor'){pf=pf-promo.valor;pb='<div class="promo-badge">-R$'+promo.valor+'</div>'}
      else{pf=promo.valor;pb='<div class="promo-badge">PROMO</div>'}
      pf=Math.max(0,pf)
    }
    return'<div class="pcard '+(sem?'off':'')+'" onclick="'+(sem?'':'addCart(\''+p.id+'\','+pf+')')+'">'+
      (!sem?'<div class="stk-badge">'+p.estoque+'</div>':'')+pb+
      '<span class="em">'+(p.emoji||'&#x1F4E6;')+'</span>'+
      '<div class="pn">'+p.nome+'</div>'+
      (promo?'<div style="font-size:10px;color:var(--txt3);text-decoration:line-through;margin-top:3px">R$ '+Number(p.preco_venda).toFixed(2)+'</div>':'')+
      '<div class="pp">R$ '+pf.toFixed(2)+'</div>'+
      (baixo?'<div class="pl">estoque baixo</div>':'')+
      (sem?'<div class="pw">sem estoque</div>':'')+
      '</div>'
  }).join('')
}

function filterProds(){renderPDV()}

function addCart(id,pf){
  var p=prods.find(function(x){return x.id===id})
  if(!p||p.estoque===0)return
  var ex=cart.find(function(x){return x.id===id})
  if(ex)ex.qty++;else cart.push(Object.assign({},p,{preco_final:pf,qty:1}))
  renderCart();toast((p.emoji||'')+' '+p.nome+' adicionado')
}

function changeQty(id,d){
  var i=cart.findIndex(function(x){return x.id===id})
  if(i<0)return
  cart[i].qty+=d
  if(cart[i].qty<=0)cart.splice(i,1)
  renderCart()
}

function renderCart(){
  var el=document.getElementById('citems')
  var cc=document.getElementById('cc')
  var ti=cart.reduce(function(a,c){return a+c.qty},0)
  if(ti>0){cc.textContent=ti;cc.style.display=''}else cc.style.display='none'
  var badge=document.getElementById('pdv-tab-badge')
  if(badge){ if(ti>0){badge.textContent=ti;badge.style.display=''}else badge.style.display='none' }
  if(!cart.length){el.innerHTML='<div class="empty">&#x1F6D2; Nenhum item</div>';updTot();salvarRascunhoCart();return}
  el.innerHTML=cart.map(function(c){
    return'<div class="ci">'+
      '<span class="ci-em">'+(c.emoji||'&#x1F4E6;')+'</span>'+
      '<div class="ci-nm">'+c.nome+'<br><small>R$ '+Number(c.preco_final).toFixed(2)+' un</small></div>'+
      '<div class="ci-qty">'+
        '<button onclick="changeQty(\''+c.id+'\',-1)">-</button>'+
        '<span>'+c.qty+'</span>'+
        '<button onclick="changeQty(\''+c.id+'\',1)">+</button>'+
      '</div>'+
      '<div class="ci-pr">R$ '+(Number(c.preco_final)*c.qty).toFixed(2)+'</div>'+
      '<button class="ci-del" title="Excluir item" onclick="removeCartItem(\''+c.id+'\')">&#x2716;</button>'+
    '</div>'
  }).join('')
  updTot()
  salvarRascunhoCart()
}

// Guarda o pedido em andamento no proprio navegador (localStorage), pra nao perder tudo se
// a luz cair, o navegador travar ou a pagina recarregar sozinha no meio de uma venda. Nao e
// um backup de verdade (fica so nessa maquina), mas resolve o caso mais comum de imprevisto.
function chaveRascunhoCart(){ return 'cf_cart_draft_'+(meuCid()||'geral') }
function salvarRascunhoCart(){
  try{
    if(cart.length)localStorage.setItem(chaveRascunhoCart(),JSON.stringify(cart))
    else localStorage.removeItem(chaveRascunhoCart())
  }catch(e){}
}
function restaurarRascunhoCart(){
  try{
    var raw=localStorage.getItem(chaveRascunhoCart())
    if(!raw)return
    var salvo=JSON.parse(raw)
    if(Array.isArray(salvo)&&salvo.length){
      cart=salvo
      renderCart()
      toast('Pedido em andamento recuperado (evita perder venda se a luz cair ou a tela travar)')
    }
  }catch(e){}
}

function removeCartItem(id){
  var i = cart.findIndex(function(x){ return x.id === id })
  if(i < 0) return
  var nome = cart[i].nome
  confirmDialog('Excluir "'+nome+'" do pedido?', function(){
    var j = cart.findIndex(function(x){ return x.id === id })
    if(j < 0) return
    cart.splice(j, 1)
    renderCart()
  }, {titulo:'Excluir item?', icone:'🗑️'})
}

function updTot(){
  var s=cart.reduce(function(a,c){return a+Number(c.preco_final)*c.qty},0)
  var orig=cart.reduce(function(a,c){return a+Number(c.preco_venda)*c.qty},0)
  document.getElementById('sub').textContent='R$ '+orig.toFixed(2)
  document.getElementById('desc-val').textContent='- R$ '+(orig-s).toFixed(2)
  document.getElementById('tot').textContent='R$ '+s.toFixed(2)
}

function calcTroco(){ /* movido para modal */ }

function finalizarVenda(){
  if(!cart.length)return
  document.getElementById('nf-modal').classList.add('open')
}

function confirmarPay(metodo){
  if(!mesaPagamentoAtivo && !cart.length){toast('Adicione produtos ao pedido',1);return}
  // Cartao: perguntar debito ou credito
  if(metodo==='Cartao'){
    document.getElementById('ov-cartao').classList.add('open')
    return
  }
  // Fiado: abrir cadastro de cliente
  if(metodo==='Fiado'){
    carregarClientesFiado()
    var venc=new Date();venc.setDate(venc.getDate()+7)
    document.getElementById('fiado-data-promessa').value=venc.toISOString().slice(0,10)
    document.getElementById('ov-fiado-cliente').classList.add('open')
    return
  }
  abrirConfirmar(metodo)
}

function abrirConfirmar(metodo){
  payMetodo=metodo
  // Fechamento de mesa reaproveita os mesmos modais de pagamento, mas o encerramento
  // e outro (comandas/mesas, nao vendas) — nunca passa pelo NF/CPF/pay() do PDV.
  if(mesaPagamentoAtivo){
    finalizarFechamentoComanda(metodo)
    return
  }
  var total=cart.reduce(function(a,c){return a+Number(c.preco_final)*c.qty},0)
  var ics={Dinheiro:'&#x1F4B5;','Cartao Debito':'&#x1F4B3;','Cartao Credito':'&#x1F4B3;',PIX:'&#x1F4F1;',Fiado:'&#x1F4D3;'}
  document.getElementById('conf-ic').innerHTML=ics[metodo]||'&#x1F4B0;'
  document.getElementById('conf-title').textContent='Confirmar pagamento?'
  document.getElementById('conf-total').textContent='R$ '+total.toFixed(2)
  document.getElementById('conf-metodo').textContent=metodo
  document.getElementById('ov-confirmar').classList.add('open')
}

function voltarPagamento(){
  closeModals()
  if(mesaPagamentoAtivo){ document.getElementById('ov-fechar-comanda').classList.add('open') }
  else{ document.getElementById('ov-resumo').classList.add('open') }
}

async function carregarClientesFiado(){
  var res=await scopeCid(db.from('clientes_fiado').select('*')).order('nome')
  var lista=res.data||[]
  var sel=document.getElementById('fiado-cliente-sel')
  sel.innerHTML='<option value="">-- Selecione ou cadastre --</option>'+lista.map(function(c){
    return'<option value="'+c.id+'">'+c.nome+' - '+c.telefone+'</option>'
  }).join('')
}

function mostrarCampoCPF(){
  document.getElementById('nf-btns-iniciais').style.display='none'
  document.getElementById('nf-campo-cpf').style.display='block'
  setTimeout(function(){ document.getElementById('cpf-nf-input').focus() }, 100)
}

function voltarNF(){
  document.getElementById('nf-btns-iniciais').style.display='flex'
  document.getElementById('nf-campo-cpf').style.display='none'
  document.getElementById('nf-tipo-doc').style.display='none'
  document.getElementById('cpf-nf-input').value=''
}

function voltarParaCPF(){
  document.getElementById('nf-tipo-doc').style.display='none'
  document.getElementById('nf-campo-cpf').style.display='block'
}

function emitirRecibo(){
  var cpf=document.getElementById('cpf-nf-input').value.trim()
  document.getElementById('nf-modal').style.display='none'
  // Finalizar venda e imprimir recibo com CPF
  pay(payMetodo, cpf, true)
}

function confirmarComCPF(){
  var cpf=document.getElementById('cpf-nf-input').value.trim()
  if(!cpf){toast('Informe o CPF',1);return}
  // Validar CPF
  if(!validarCPFStr(cpf)){
    toast('CPF invalido! Verifique os numeros.',1)
    document.getElementById('cpf-nf-input').style.borderColor='var(--red)'
    return
  }
  document.getElementById('cpf-nf-input').style.borderColor='var(--green)'
  // Perguntar tipo de documento
  document.getElementById('nf-campo-cpf').style.display='none'
  document.getElementById('nf-tipo-doc').style.display='block'
  document.getElementById('nf-cpf-confirmado').textContent='CPF: '+cpf
}

function validarCPFStr(cpf){
  var c=cpf.replace(/\D/g,'')
  if(c.length!==11)return false
  if(/^(\d)\1{10}$/.test(c))return false
  var soma=0
  for(var i=0;i<9;i++)soma+=parseInt(c[i])*(10-i)
  var r=11-(soma%11);if(r>=10)r=0
  if(r!==parseInt(c[9]))return false
  soma=0
  for(var i=0;i<10;i++)soma+=parseInt(c[i])*(11-i)
  r=11-(soma%11);if(r>=10)r=0
  return r===parseInt(c[10])
}

function nfNao(){
  document.getElementById('nf-modal').style.display='none'
  pay(payMetodo,'')
}

function confirmarFiado(){
  var sel=document.getElementById('fiado-cliente-sel')
  var clienteId=sel.value
  var clienteNome=sel.options[sel.selectedIndex]?sel.options[sel.selectedIndex].text:''
  var dataPromessa=document.getElementById('fiado-data-promessa').value
  if(!clienteId){toast('Selecione um cliente',1);return}
  if(!dataPromessa){toast('Informe a data prometida de pagamento',1);return}
  closeModals()
  payMetodo='Fiado'
  payClienteFiado={id:clienteId,nome:clienteNome,dataPromessa:dataPromessa}
  abrirConfirmar('Fiado - '+clienteNome.split(' - ')[0])
}

function confirmarVenda(){
  closeModals()
  // Resetar estado do modal NF
  document.getElementById('nf-btns-iniciais').style.display='flex'
  document.getElementById('nf-campo-cpf').style.display='none'
  document.getElementById('nf-tipo-doc').style.display='none'
  var cpfEl=document.getElementById('cpf-nf-input')
  if(cpfEl)cpfEl.value=''
  document.getElementById('nf-modal').style.display='flex'
}

async function pay(metodo,cpf,imprimirRecibo){
  if(!cart.length){toast('Adicione produtos',1);return}
  var total=cart.reduce(function(a,c){return a+Number(c.preco_final)*c.qty},0)
  var res=await db.from('vendas').insert({total:total,forma_pagamento:metodo,cliente_id:meuCid()}).select().single()
  if(res.error){toast('Erro ao registrar venda',1);return}
  var venda=res.data
  await db.from('itens_venda').insert(cart.map(function(c){
    return{venda_id:venda.id,produto_id:c.id,quantidade:c.qty,preco_unitario:Number(c.preco_final),cliente_id:meuCid()}
  }))
  for(var i=0;i<cart.length;i++){
    var c=cart[i]
    var p=prods.find(function(x){return x.id===c.id})
    if(p){var ne=p.estoque-c.qty;await db.from('produtos').update({estoque:ne}).eq('id',c.id);p.estoque=ne}
  }
  // Fiado: lancar automaticamente em Contas a Receber, vinculado ao cliente e com a data prometida
  // (metodo vem como "Fiado - Nome do cliente", por isso o indexOf em vez de igualdade exata)
  if(metodo.indexOf('Fiado')===0&&payClienteFiado){
    await db.from('contas_receber').insert({
      descricao:'Fiado - '+payClienteFiado.nome,
      cliente_nome:payClienteFiado.nome,
      cliente_fiado_id:payClienteFiado.id,
      venda_id:venda.id,
      valor:total,
      vencimento:payClienteFiado.dataPromessa,
      cliente_id:meuCid()
    })
    payClienteFiado=null
  }
  var msg='Pagamento '+metodo+' - R$ '+total.toFixed(2)+'!'
  if(cpf)msg+=' | CPF: '+cpf
  toast(msg)
  cartSnapshot=cart.slice()
  if(imprimirRecibo&&cpf) imprimirReciboComCPF(cpf,metodo,total,venda.id,venda.criado_em)
  cart=[];renderCart();renderPDV();updateBadge()
}

function escaparHtmlRecibo(valor){
  return String(valor==null?'':valor)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#039;')
}

function moedaRecibo(valor){
  return Number(valor||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})
}

function montarHtmlReciboComCPF(cpf,metodo,total,vendaId,criadoEm,itens){
  var loja=localStorage.getItem('nome_loja')||'CONVENFÁCIL'
  var cnpj=localStorage.getItem('cnpj_loja')||''
  var telefone=localStorage.getItem('tel_loja')||''
  var endereco=localStorage.getItem('end_loja')||''
  var cidade=localStorage.getItem('cidade_loja')||''
  var rodape=localStorage.getItem('rodape_cupom')||'Obrigado pela preferência!'
  var dataVenda=criadoEm?new Date(criadoEm):new Date()
  if(isNaN(dataVenda.getTime()))dataVenda=new Date()
  var dt=dataVenda.toLocaleDateString('pt-BR')+' às '+dataVenda.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})
  var numeroRecibo=vendaId?String(vendaId).replace(/-/g,'').slice(0,8).toUpperCase():String(Date.now()).slice(-8)
  itens=Array.isArray(itens)?itens:[]
  var subtotal=itens.reduce(function(a,c){return a+Number(c.preco_venda||c.preco_final)*c.qty},0)
  var desconto=Math.max(0,subtotal-Number(total))
  var itensHTML=itens.map(function(c){
    var nome=escaparHtmlRecibo(c.nome)
    var unitario=Number(c.preco_final)
    var quantidade=Number(c.qty)
    return '<tr>'+
      '<td class="item-desc"><strong>'+nome+'</strong><span>'+quantidade+' × '+moedaRecibo(unitario)+'</span></td>'+
      '<td class="item-total">'+moedaRecibo(unitario*quantidade)+'</td>'+
    '</tr>'
  }).join('')
  var localizacao=[endereco,cidade].filter(Boolean).map(escaparHtmlRecibo).join(' • ')
  return '<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">'+
    '<meta name="viewport" content="width=device-width,initial-scale=1">'+
    '<title>Recibo '+numeroRecibo+'</title>'+
    '<style>'+
      '@page{size:80mm auto;margin:0}'+
      '*{box-sizing:border-box}'+
      'html,body{margin:0;padding:0;background:#fff;color:#111}'+
      'body{width:80mm;min-height:100%;padding:5mm 4mm 7mm;font-family:Arial,Helvetica,sans-serif;font-size:10.5px;line-height:1.35}'+
      '.center{text-align:center}.muted{color:#444}.strong{font-weight:700}'+
      '.brand{font-size:18px;font-weight:800;line-height:1.1;letter-spacing:.3px;text-transform:uppercase;margin-bottom:3px}'+
      '.store-meta{font-size:9.5px;line-height:1.45}'+
      '.divider{border:0;border-top:1px dashed #555;margin:10px 0}'+
      '.doc-head{display:flex;align-items:flex-start;justify-content:space-between;gap:8px}'+
      '.doc-title{font-size:13px;font-weight:800;text-transform:uppercase;letter-spacing:.6px}'+
      '.doc-number{text-align:right;font-size:9px;white-space:nowrap}'+
      '.customer{border:1px solid #222;border-radius:4px;padding:7px 8px;margin:9px 0}'+
      '.customer-label{display:block;font-size:8px;text-transform:uppercase;letter-spacing:.7px;margin-bottom:2px;color:#444}'+
      '.customer-value{font-size:13px;font-weight:800;letter-spacing:.4px}'+
      'table{width:100%;border-collapse:collapse;table-layout:fixed}'+
      'thead th{font-size:8px;text-transform:uppercase;letter-spacing:.5px;text-align:left;border-bottom:1px solid #222;padding:0 0 5px}'+
      'thead th:last-child{text-align:right;width:27mm}'+
      'tbody td{padding:7px 0;border-bottom:1px dotted #aaa;vertical-align:top}'+
      '.item-desc{padding-right:8px;overflow-wrap:anywhere}.item-desc strong{display:block;font-size:10.5px}.item-desc span{display:block;color:#444;font-size:9px;margin-top:2px}'+
      '.item-total{text-align:right;font-weight:700;white-space:nowrap}'+
      '.summary{margin-top:8px}.summary-row{display:flex;justify-content:space-between;gap:10px;padding:2px 0}'+
      '.discount{font-weight:700}'+
      '.grand-total{border:2px solid #111;border-radius:4px;margin:7px 0;padding:7px 8px;font-size:16px;font-weight:900;display:flex;justify-content:space-between}'+
      '.payment{display:flex;justify-content:space-between;font-weight:700;padding:2px 0}'+
      '.footer{margin-top:12px;text-align:center;font-size:9px;line-height:1.45}'+
      '.fiscal-note{font-weight:800;text-transform:uppercase;margin-bottom:7px}'+
      '.signature{margin-top:18px;border-top:1px solid #555;padding-top:4px}'+
      '@media print{html,body{width:80mm;-webkit-print-color-adjust:exact;print-color-adjust:exact}}'+
    '</style></head><body>'+
      '<header class="center">'+
        '<div class="brand">'+escaparHtmlRecibo(loja)+'</div>'+
        '<div class="store-meta">'+
          (cnpj?'<div>CNPJ: '+escaparHtmlRecibo(cnpj)+'</div>':'')+
          (localizacao?'<div>'+localizacao+'</div>':'')+
          (telefone?'<div>Telefone: '+escaparHtmlRecibo(telefone)+'</div>':'')+
        '</div>'+
      '</header>'+
      '<hr class="divider">'+
      '<section class="doc-head">'+
        '<div><div class="doc-title">Recibo de venda</div><div class="muted">'+dt+'</div></div>'+
        '<div class="doc-number"><span class="muted">Nº do recibo</span><br><strong>'+numeroRecibo+'</strong></div>'+
      '</section>'+
      '<section class="customer"><span class="customer-label">CPF do consumidor</span><span class="customer-value">'+escaparHtmlRecibo(cpf)+'</span></section>'+
      '<table><thead><tr><th>Descrição</th><th>Valor</th></tr></thead><tbody>'+itensHTML+'</tbody></table>'+
      '<section class="summary">'+
        '<div class="summary-row"><span>Subtotal</span><strong>'+moedaRecibo(subtotal)+'</strong></div>'+
        (desconto>0.009?'<div class="summary-row discount"><span>Desconto</span><span>- '+moedaRecibo(desconto)+'</span></div>':'')+
        '<div class="grand-total"><span>Total</span><span>'+moedaRecibo(total)+'</span></div>'+
        '<div class="payment"><span>Pagamento</span><span>'+escaparHtmlRecibo(metodo)+'</span></div>'+
      '</section>'+
      '<hr class="divider">'+
      '<footer class="footer">'+
        '<div class="fiscal-note">Documento sem valor fiscal</div>'+
        '<div>'+escaparHtmlRecibo(rodape)+'</div>'+
        '<div class="signature">ConvenFácil • convenfacil.com.br</div>'+
      '</footer>'+
    '</body></html>'
}

function imprimirReciboComCPF(cpf,metodo,total,vendaId,criadoEm){
  var html=montarHtmlReciboComCPF(cpf,metodo,total,vendaId,criadoEm,cartSnapshot)
  imprimirComPreview(html,'Recibo pronto para imprimir')
}

function clearCart(){
  if(cart.length){
    var total=cart.reduce(function(a,c){return a+Number(c.preco_final)*c.qty},0)
    var itensDesc=cart.map(function(c){return c.qty+'x '+c.nome}).join(', ')
    var itensCompletos=cart.map(function(c){
      return{nome:c.nome,qty:c.qty,preco_venda:Number(c.preco_venda),preco_final:Number(c.preco_final),subtotal:Number(c.preco_final)*c.qty}
    })
    registrarExcecao('PEDIDO LIMPO COM ITENS', itensDesc+'. Total: R$ '+total.toFixed(2), total, itensCompletos)
  }
  cart=[];renderCart()
}

// PROMOÇÕES
function renderPromos(){
  var g=document.getElementById('promo-grid')
  if(!promos.length){g.innerHTML='<div class="empty">Nenhuma promocao</div>';return}
  var tipos={percent:'Desconto %',valor:'Desconto R$',preco:'Preco promocional'}
  g.innerHTML=promos.map(function(pr){
    var p=prods.find(function(x){return x.id===pr.produto_id})
    if(!p)return''
    var desc=pr.tipo==='percent'?pr.valor+'% de desconto':pr.tipo==='valor'?'R$ '+Number(pr.valor).toFixed(2)+' de desconto':'Por apenas R$ '+Number(pr.valor).toFixed(2)
    return'<div class="promo-card">'+
      '<div class="promo-type">'+(tipos[pr.tipo]||pr.tipo)+'</div>'+
      '<div class="promo-name">'+(p.emoji||'')+' '+p.nome+'</div>'+
      '<div class="promo-desc">'+(pr.descricao||'')+'</div>'+
      '<div class="promo-val">'+desc+'</div>'+
      '<div class="promo-valid">Valido ate: '+new Date(pr.valido_ate+'T12:00:00').toLocaleDateString('pt-BR')+'</div>'+
      '<div class="promo-actions">'+
        '<button class="btn sm" onclick="editPromoCartaz(\''+pr.id+'\')" style="background:rgba(167,139,250,.15);color:var(--purple);border-color:rgba(167,139,250,.3)">&#x1F5A8; Cartaz A4</button>'+
        '<button class="btn sm yellow" onclick="editPromo(\''+pr.id+'\')">✏ Editar</button>'+
        '<button class="btn sm red" onclick="delPromo(\''+pr.id+'\')">🗑 Excluir</button>'+
      '</div>'+
    '</div>'
  }).join('')
}

async function delPromo(id){
  confirmDialog('Excluir esta promocao?', async function(){
    await db.from('promocoes').delete().eq('id',id)
    promos=promos.filter(function(x){return x.id!==id})
    renderPromos();renderPDV();toast('Promocao excluida')
  })
}

function editPromoCartaz(id){
  editPromo(id)
  setTimeout(function(){ switchTab('cartaz') }, 100)
}

function editPromo(id){
  var pr=promos.find(function(x){return x.id===id})
  if(!pr)return
  document.getElementById('promo-modal-title').textContent='Editar promoção'
  document.getElementById('promo-id').value=pr.id
  document.getElementById('promo-prod').innerHTML=prods.map(function(p){return'<option value="'+p.id+'"'+(p.id===pr.produto_id?' selected':'')+'>'+p.nome+'</option>'}).join('')
  document.getElementById('promo-tipo').value=pr.tipo
  document.getElementById('promo-val').value=pr.valor
  document.getElementById('promo-ate').value=pr.valido_ate
  document.getElementById('promo-desc').value=pr.descricao||''
  document.getElementById('ov-promo').classList.add('open')
}

// ESTOQUE
function renderEstoque(){
  var tb=document.getElementById('stk-tb')
  if(!prods.length){tb.innerHTML='<tr><td colspan="10"><div class="empty">Nenhum produto</div></td></tr>';return}
  tb.innerHTML=prods.map(function(p){
    var st=p.estoque===0?'out':p.estoque<=p.estoque_minimo?'low':'ok'
    var lb=p.estoque===0?'Zerado':p.estoque<=p.estoque_minimo?'Baixo':'Normal'
    var mg=p.preco_custo>0?(((p.preco_venda-p.preco_custo)/p.preco_custo)*100).toFixed(0):0
    var cor=p.estoque===0?'var(--red)':p.estoque<=p.estoque_minimo?'var(--yellow)':'var(--txt1)'
    var vencInfo=infoValidade(p.validade)
    return'<tr>'+
      '<td><span style="margin-right:7px;font-size:16px">'+(p.emoji||'&#x1F4E6;')+'</span><strong>'+p.nome+'</strong></td>'+
      '<td><span class="tag bl">'+(p.categoria||'-')+'</span></td>'+
      '<td style="font-weight:700;color:'+cor+'">'+p.estoque+'</td>'+
      '<td style="color:var(--txt3)">'+p.estoque_minimo+'</td>'+
      '<td style="color:var(--txt2)">R$ '+Number(p.preco_custo).toFixed(2)+'</td>'+
      '<td style="color:var(--acc);font-weight:600">R$ '+Number(p.preco_venda).toFixed(2)+'</td>'+
      '<td><span class="tag '+(parseInt(mg)>=30?'ok':parseInt(mg)>=15?'low':'out')+'">'+mg+'%</span></td>'+
      '<td><span class="tag '+st+'">'+lb+'</span></td>'+
      '<td style="color:'+vencInfo.cor+';font-weight:600;font-size:12px">'+vencInfo.texto+'</td>'+
      '<td style="display:flex;gap:5px">'+
        '<button class="btn sm" onclick="restock(\''+p.id+'\')">+ Repor</button>'+
        (perm('editar')?'<button class="btn sm yellow" onclick="editProd(\''+p.id+'\')">&#x270F;</button>':'')+
        (perm('excluir')?'<button class="btn sm red" onclick="delProd(\''+p.id+'\')">&#x1F5D1;</button>':'')+'</td>'+
    '</tr>'
  }).join('')
  var baixos=prods.filter(function(p){return p.estoque<=p.estoque_minimo})
  var vencendo=prods.filter(function(p){return infoValidade(p.validade).alerta})
  var alrt=document.getElementById('alrt')
  var partes=[]
  if(baixos.length)partes.push(baixos.length+' produto(s) com estoque baixo: '+baixos.map(function(p){return p.nome}).join(', '))
  if(vencendo.length)partes.push(vencendo.length+' produto(s) vencido(s) ou vencendo em breve: '+vencendo.map(function(p){return p.nome}).join(', '))
  if(partes.length){alrt.style.display='flex';document.getElementById('alrt-msg').textContent=partes.join(' | ')}
  else alrt.style.display='none'
}

function infoValidade(validade){
  if(!validade)return{texto:'-',cor:'var(--txt3)',alerta:false}
  var hoje=new Date();hoje.setHours(0,0,0,0)
  var v=new Date(validade+'T00:00:00')
  var dias=Math.round((v-hoje)/86400000)
  var txt=v.toLocaleDateString('pt-BR')
  if(dias<0)return{texto:txt+' (vencido)',cor:'var(--red)',alerta:true}
  if(dias<=7)return{texto:txt+' (vence em '+dias+'d)',cor:'var(--yellow)',alerta:true}
  return{texto:txt,cor:'var(--txt2)',alerta:false}
}

function abrirBaixaEstragado(){
  if(!prods.length){toast('Nenhum produto cadastrado',1);return}
  var sel=document.getElementById('be-produto-sel')
  sel.innerHTML='<option value="">-- Selecione --</option>'+prods.map(function(p){
    return'<option value="'+p.id+'">'+p.nome+' (estoque: '+p.estoque+')</option>'
  }).join('')
  document.getElementById('be-qtd').value=''
  document.getElementById('ov-baixa-estragado').classList.add('open')
}

async function confirmarBaixaEstragado(){
  var produtoId=document.getElementById('be-produto-sel').value
  var qtd=parseInt(document.getElementById('be-qtd').value)
  if(!produtoId){toast('Selecione um produto',1);return}
  if(!qtd||qtd<1){toast('Informe uma quantidade valida',1);return}
  var p=prods.find(function(x){return x.id===produtoId})
  if(!p){toast('Produto nao encontrado',1);return}
  var novoEstoque=Math.max(p.estoque-qtd,0)
  var res=await db.from('produtos').update({estoque:novoEstoque}).eq('id',produtoId)
  if(res.error){toast('Erro ao baixar estoque',1);return}
  p.estoque=novoEstoque
  closeModals()
  toast('Baixa realizada: -'+qtd+' '+p.nome)
  renderEstoque();renderPDV();updateBadge()
}

function renderListaCompras(){
  var tb=document.getElementById('lc-tb')
  var baixos=prods.filter(function(p){return p.estoque<=p.estoque_minimo})
  if(!baixos.length){tb.innerHTML='<tr><td colspan="5"><div class="empty">Nenhum produto com estoque baixo. Tudo certo por aqui!</div></td></tr>';return}
  tb.innerHTML=baixos.map(function(p){
    var sugestao=Math.max((p.estoque_minimo*2)-p.estoque,p.estoque_minimo)
    var cor=p.estoque===0?'var(--red)':'var(--yellow)'
    return'<tr>'+
      '<td><span style="margin-right:7px;font-size:16px">'+(p.emoji||'&#x1F4E6;')+'</span><strong>'+p.nome+'</strong></td>'+
      '<td><span class="tag bl">'+(p.categoria||'-')+'</span></td>'+
      '<td style="font-weight:700;color:'+cor+'">'+p.estoque+'</td>'+
      '<td style="color:var(--txt3)">'+p.estoque_minimo+'</td>'+
      '<td style="font-weight:700;color:var(--green)">'+sugestao+' un.</td>'+
    '</tr>'
  }).join('')
}

function imprimirListaCompras(){
  var baixos=prods.filter(function(p){return p.estoque<=p.estoque_minimo})
  if(!baixos.length){toast('Nenhum produto com estoque baixo',1);return}
  var loja=localStorage.getItem('nome_loja')||'CONVENFACIL'
  var now=new Date()
  var dt=now.toLocaleDateString('pt-BR')+' '+now.toLocaleTimeString('pt-BR')
  var linhas=baixos.map(function(p){
    var sugestao=Math.max((p.estoque_minimo*2)-p.estoque,p.estoque_minimo)
    return'<tr><td style="padding:6px 8px;border-bottom:1px solid #ddd">'+p.nome+'</td>'+
      '<td style="padding:6px 8px;border-bottom:1px solid #ddd;text-align:center">'+p.estoque+'</td>'+
      '<td style="padding:6px 8px;border-bottom:1px solid #ddd;text-align:center;font-weight:700">'+sugestao+'</td>'+
      '<td style="padding:6px 8px;border-bottom:1px solid #ddd">&nbsp;</td></tr>'
  }).join('')
  var html='<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Lista de Compras</title>'+
    '<style>*{box-sizing:border-box;font-family:Arial,sans-serif}body{padding:20px;color:#000}'+
    'h1{font-size:20px;margin-bottom:2px}p{font-size:12px;color:#555;margin-bottom:16px}'+
    'table{width:100%;border-collapse:collapse;font-size:13px}th{text-align:left;padding:6px 8px;border-bottom:2px solid #000}</style>'+
    '</head><body>'+
    '<h1>'+loja+': Lista de Compras</h1>'+
    '<p>Gerado em '+dt+'</p>'+
    '<table><thead><tr><th>Produto</th><th style="text-align:center">Estoque atual</th><th style="text-align:center">Comprar</th><th>Comprado?</th></tr></thead>'+
    '<tbody>'+linhas+'</tbody></table>'+
    '</body></html>'
  imprimirComPreview(html,'Lista de compras pronta para impressao')
}

async function restock(id){
  var p=prods.find(function(x){return x.id===id})
  if(!p)return
  var qtd=parseInt(prompt('Repor "'+p.nome+'" - quantas unidades?')||'0')
  if(qtd>0){
    var ne=p.estoque+qtd
    await db.from('produtos').update({estoque:ne}).eq('id',id)
    await db.from('reposicoes_estoque').insert({produto_id:id,produto_nome:p.nome,quantidade:qtd,cliente_id:meuCid()})
    p.estoque=ne;renderEstoque();renderPDV();updateBadge()
    toast('+'+qtd+' unidades!')
  }
}

var CATEGORIAS_PADRAO=['Bebidas','Energeticos','Snacks e Salgadinhos','Chocolates e Doces','Laticinios','Alimentacao Rapida','Tabacaria','Higiene Pessoal','Preservativos','Medicamentos OTC','Limpeza','Eletronicos e Acessorios','Recarga e Servicos','Loteria e Jogos','Outros']
var categoriasCache=[]

async function carregarCategorias(){
  var res=await scopeCid(db.from('categorias').select('*')).order('nome')
  var lista=res.data||[]
  if(!lista.length){
    await db.from('categorias').insert(CATEGORIAS_PADRAO.map(function(n){return{nome:n,cliente_id:meuCid()}}))
    res=await scopeCid(db.from('categorias').select('*')).order('nome')
    lista=res.data||[]
  }
  // Auto-corrige: garante que toda categoria ja usada em algum produto exista na lista de categorias
  var nomesExistentes=lista.map(function(c){return c.nome})
  var usadasEmProdutos=[...new Set(prods.map(function(p){return p.categoria}).filter(Boolean))]
  var faltando=usadasEmProdutos.filter(function(n){return nomesExistentes.indexOf(n)===-1})
  if(faltando.length){
    await db.from('categorias').insert(faltando.map(function(n){return{nome:n,cliente_id:meuCid()}}))
    res=await scopeCid(db.from('categorias').select('*')).order('nome')
    lista=res.data||[]
  }
  categoriasCache=lista
  return lista
}

function preencherSelectCategorias(){
  var sel=document.getElementById('np-cat')
  var atual=sel.value
  sel.innerHTML=categoriasCache.map(function(c){return'<option>'+c.nome+'</option>'}).join('')
  if(atual)sel.value=atual
}

async function renderCategorias(){
  await carregarCategorias()
  preencherSelectCategorias()
  var tb=document.getElementById('cat-tb')
  if(!categoriasCache.length){tb.innerHTML='<tr><td colspan="2"><div class="empty">Nenhuma categoria cadastrada</div></td></tr>';return}
  tb.innerHTML=categoriasCache.map(function(c){
    return'<tr><td><strong>'+c.nome+'</strong></td>'+
      '<td><button class="btn sm red" onclick="delCategoria(\''+c.id+'\')">Excluir</button></td></tr>'
  }).join('')
}

function abrirCategoriaRapida(){
  document.getElementById('cat-rapida-nome').value=''
  document.getElementById('ov-cat-rapida').classList.add('open')
  setTimeout(function(){document.getElementById('cat-rapida-nome').focus()},100)
}

async function confirmarCategoriaRapida(){
  var nome=document.getElementById('cat-rapida-nome').value.trim()
  if(!nome){toast('Informe o nome da categoria',1);return}
  var existe=categoriasCache.find(function(c){return c.nome.toLowerCase()===nome.toLowerCase()})
  if(existe){
    document.getElementById('ov-cat-rapida').classList.remove('open')
    document.getElementById('np-cat').value=existe.nome
    toast('Categoria ja existia, selecionada')
    return
  }
  var res=await db.from('categorias').insert({nome:nome,cliente_id:meuCid()})
  if(res.error){toast('Erro ao cadastrar categoria',1);return}
  await carregarCategorias()
  preencherSelectCategorias()
  document.getElementById('np-cat').value=nome
  document.getElementById('ov-cat-rapida').classList.remove('open')
  toast('Categoria cadastrada!')
}

async function addCategoria(){
  var nome=document.getElementById('cat-nova-nome').value.trim()
  if(!nome){toast('Informe o nome da categoria',1);return}
  var res=await db.from('categorias').insert({nome:nome,cliente_id:meuCid()})
  if(res.error){toast('Erro ao cadastrar categoria',1);return}
  document.getElementById('cat-nova-nome').value=''
  toast('Categoria cadastrada!')
  renderCategorias()
}

async function delCategoria(id){
  confirmDialog('Produtos ja cadastrados com ela nao serao alterados.', async function(){
    await db.from('categorias').delete().eq('id',id)
    toast('Categoria excluida')
    renderCategorias()
  }, {titulo:'Excluir esta categoria?'})
}

async function renderHistoricoReposicao(){
  var tb=document.getElementById('hr-tb')
  var res=await scopeCid(db.from('reposicoes_estoque').select('*')).order('criado_em',{ascending:false}).limit(200)
  var lista=res.data||[]
  if(!lista.length){tb.innerHTML='<tr><td colspan="3"><div class="empty">Nenhuma reposicao registrada ainda</div></td></tr>';return}
  tb.innerHTML=lista.map(function(r){
    var dt=new Date(r.criado_em).toLocaleString('pt-BR')
    return'<tr>'+
      '<td style="color:var(--txt2)">'+dt+'</td>'+
      '<td><strong>'+(r.produto_nome||'-')+'</strong></td>'+
      '<td style="color:var(--green);font-weight:700">+'+r.quantidade+'</td>'+
    '</tr>'
  }).join('')
}

function updateBadge(){
  var baixos=prods.filter(function(p){return p.estoque<=p.estoque_minimo})
  var bdg=document.getElementById('bdg')
  if(bdg){if(baixos.length){bdg.textContent=baixos.length;bdg.style.display=''}else bdg.style.display='none'}
}

// FINANCEIRO
async function renderFin(){
  var results=await Promise.all([
    scopeCid(db.from('vendas').select('*')).order('criado_em',{ascending:false}),
    scopeCid(db.from('contas_pagar').select('valor')).eq('pago',false),
    scopeCid(db.from('contas_receber').select('valor')).eq('recebido',false)
  ])
  var vendas=results[0].data||[]
  var totalCP=(results[1].data||[]).reduce(function(a,c){return a+Number(c.valor)},0)
  var totalCR=(results[2].data||[]).reduce(function(a,c){return a+Number(c.valor)},0)
  var total=vendas.reduce(function(a,v){return a+Number(v.total)},0)
  document.getElementById('f-rec').textContent='R$ '+total.toFixed(2)
  document.getElementById('f-vnd').textContent=vendas.length+' vendas'
  document.getElementById('f-pagar').textContent='R$ '+totalCP.toFixed(2)
  document.getElementById('f-receber').textContent='R$ '+totalCR.toFixed(2)
  document.getElementById('f-tkt').textContent='R$ '+(vendas.length?total/vendas.length:0).toFixed(2)
  var pag={Dinheiro:0,Cartao:0,PIX:0,Fiado:0}
  vendas.forEach(function(v){pag[v.forma_pagamento]=(pag[v.forma_pagamento]||0)+Number(v.total)})
  document.getElementById('p-din').textContent='R$ '+(pag['Dinheiro']||0).toFixed(2)
  document.getElementById('p-crt').textContent='R$ '+(pag['Cartao']||0).toFixed(2)
  document.getElementById('p-pix').textContent='R$ '+(pag['PIX']||0).toFixed(2)
  document.getElementById('p-fid').textContent='R$ '+(pag['Fiado']||0).toFixed(2)
  var dias=['Dom','Seg','Ter','Qua','Qui','Sex','Sab']
  var hoje=new Date()
  var u7=Array.from({length:7},function(_,i){var d=new Date(hoje);d.setDate(d.getDate()-(6-i));return{label:dias[d.getDay()],data:d.toISOString().slice(0,10),total:0}})
  vendas.forEach(function(v){var dia=new Date(v.criado_em).toISOString().slice(0,10);var e=u7.find(function(x){return x.data===dia});if(e)e.total+=Number(v.total)})
  var mx=Math.max.apply(null,u7.map(function(x){return x.total}).concat([1]))
  document.getElementById('bchart').innerHTML=u7.every(function(x){return x.total===0})?'<div class="empty" style="flex:1">Nenhuma venda</div>':u7.map(function(d){return'<div class="bc"><div class="bval">'+(d.total>0?'R$'+d.total.toFixed(0):'')+'</div><div class="bar" style="height:'+Math.round((d.total/mx)*100)+'px"></div><div class="blbl">'+d.label+'</div></div>'}).join('')
  // Ultimas vendas
  var uv=document.getElementById('ultimas-vendas')
  var ult=vendas.slice(0,8)
  if(!ult.length){uv.innerHTML='<div class="empty" style="padding:12px 0">Nenhuma venda</div>';return}
  uv.innerHTML=ult.map(function(v){
    var dt=new Date(v.criado_em)
    return'<div class="lrow"><span>'+dt.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})+' - '+v.forma_pagamento+'</span><strong style="color:var(--green)">R$ '+Number(v.total).toFixed(2)+'</strong></div>'
  }).join('')
}

// CONTAS A PAGAR
async function renderContasPagar(){
  var res=await scopeCid(db.from('contas_pagar').select('*')).order('vencimento')
  var contas=res.data||[]
  var hoje=new Date().toISOString().slice(0,10)
  var mes=hoje.slice(0,7)
  var abertas=contas.filter(function(c){return!c.pago})
  var vencidas=abertas.filter(function(c){return c.vencimento<=hoje})
  var pagas=contas.filter(function(c){return c.pago&&c.data_pagamento&&c.data_pagamento.slice(0,7)===mes})
  document.getElementById('cp-total').textContent='R$ '+abertas.reduce(function(a,c){return a+Number(c.valor)},0).toFixed(2)
  document.getElementById('cp-count').textContent=abertas.length+' contas'
  document.getElementById('cp-vence').textContent='R$ '+vencidas.reduce(function(a,c){return a+Number(c.valor)},0).toFixed(2)
  document.getElementById('cp-vence-count').textContent=vencidas.length+' contas'
  document.getElementById('cp-pago').textContent='R$ '+pagas.reduce(function(a,c){return a+Number(c.valor)},0).toFixed(2)
  document.getElementById('cp-pago-count').textContent=pagas.length+' pagas'
  var tb=document.getElementById('cp-tb')
  if(!contas.length){tb.innerHTML='<tr><td colspan="6"><div class="empty">Nenhuma conta</div></td></tr>';return}
  tb.innerHTML=contas.map(function(c){
    var atrasada=!c.pago&&c.vencimento<hoje
    var venceHoje=!c.pago&&c.vencimento===hoje
    var stClass=c.pago?'ok':atrasada?'out':venceHoje?'low':'bl'
    var stLabel=c.pago?'Pago':atrasada?'Atrasado':venceHoje?'Vence hoje':'A vencer'
    var cor=c.pago?'var(--green)':atrasada?'var(--red)':'var(--txt1)'
    return'<tr>'+
      '<td><strong>'+c.descricao+'</strong>'+(c.observacao?'<br><small style="color:var(--txt3)">'+c.observacao+'</small>':'')+'</td>'+
      '<td><span class="tag bl">'+c.categoria+'</span></td>'+
      '<td style="font-weight:700;color:'+cor+'">R$ '+Number(c.valor).toFixed(2)+'</td>'+
      '<td style="color:'+(atrasada?'var(--red)':'var(--txt2)')+'">'+new Date(c.vencimento+'T12:00:00').toLocaleDateString('pt-BR')+'</td>'+
      '<td><span class="tag '+stClass+'">'+stLabel+'</span></td>'+
      '<td style="display:flex;gap:5px">'+
        (!c.pago?'<button class="btn sm grn" onclick="pagarConta(\''+c.id+'\')">Pagar</button>':'')+
        '<button class="btn sm red" onclick="excluirConta(\''+c.id+'\',\'pagar\')">Excluir</button>'+
      '</td>'+
    '</tr>'
  }).join('')
}

async function pagarConta(id){
  var hoje=new Date().toISOString().slice(0,10)
  await db.from('contas_pagar').update({pago:true,data_pagamento:hoje}).eq('id',id)
  renderContasPagar();toast('Conta marcada como paga!')
}

async function excluirConta(id,tipo){
  confirmDialog('Excluir esta conta?', async function(){
    await db.from('contas_'+tipo).delete().eq('id',id)
    if(tipo==='pagar')renderContasPagar();else renderContasReceber()
    toast('Conta excluida')
  })
}

function printRelPagar(periodo){
  var t=periodo==='dia'?'Hoje':periodo==='semana'?'Esta semana':'Este mes'
  document.getElementById('rel-periodo').value=periodo
  document.getElementById('rel-tipo').value='pagar'
  renderRelatorio().then(function(){
    setTimeout(printRel, 800)
  })
  // Navegar para relatorio
  var navRel=document.getElementById('nav-relatorio')
  if(navRel) go('relatorio', navRel)
}

// CONTAS A RECEBER
async function renderContasReceber(){
  var res=await scopeCid(db.from('contas_receber').select('*')).order('vencimento')
  var contas=res.data||[]
  var hoje=new Date().toISOString().slice(0,10)
  var mes=hoje.slice(0,7)
  var abertas=contas.filter(function(c){return!c.recebido})
  var atrasadas=abertas.filter(function(c){return c.vencimento<hoje})
  var recebidas=contas.filter(function(c){return c.recebido&&c.data_recebimento&&c.data_recebimento.slice(0,7)===mes})
  document.getElementById('cr-total').textContent='R$ '+abertas.reduce(function(a,c){return a+Number(c.valor)},0).toFixed(2)
  document.getElementById('cr-count').textContent=abertas.length+' contas'
  document.getElementById('cr-atrasado').textContent='R$ '+atrasadas.reduce(function(a,c){return a+Number(c.valor)},0).toFixed(2)
  document.getElementById('cr-atrasado-count').textContent=atrasadas.length+' atrasadas'
  document.getElementById('cr-recebido').textContent='R$ '+recebidas.reduce(function(a,c){return a+Number(c.valor)},0).toFixed(2)
  document.getElementById('cr-recebido-count').textContent=recebidas.length+' recebidos'
  // Fiados do dia
  var fiadosDia=await scopeCid(db.from('vendas').select('*')).eq('forma_pagamento','Fiado').gte('criado_em',hoje)
  var fd=fiadosDia.data||[]
  var fdEl=document.getElementById('fiados-dia')
  if(!fd.length){fdEl.innerHTML='<div class="empty" style="padding:12px 0">Nenhum fiado hoje</div>'}
  else{fdEl.innerHTML=fd.map(function(v){return'<div class="lrow"><span>'+new Date(v.criado_em).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})+'</span><strong style="color:var(--red)">R$ '+Number(v.total).toFixed(2)+'</strong></div>'}).join('')}
  var tb=document.getElementById('cr-tb')
  if(!contas.length){tb.innerHTML='<tr><td colspan="6"><div class="empty">Nenhuma conta</div></td></tr>';return}
  tb.innerHTML=contas.map(function(c){
    var atrasada=!c.recebido&&c.vencimento<hoje
    var venceHoje=!c.recebido&&c.vencimento===hoje
    var stClass=c.recebido?'ok':atrasada?'out':venceHoje?'low':'bl'
    var stLabel=c.recebido?'Recebido':atrasada?'Atrasado':venceHoje?'Vence hoje':'A receber'
    var cor=c.recebido?'var(--green)':atrasada?'var(--red)':'var(--txt1)'
    return'<tr>'+
      '<td><strong>'+c.descricao+'</strong>'+(c.observacao?'<br><small style="color:var(--txt3)">'+c.observacao+'</small>':'')+'</td>'+
      '<td style="color:var(--txt2)">'+c.cliente_nome+'</td>'+
      '<td style="font-weight:700;color:'+cor+'">R$ '+Number(c.valor).toFixed(2)+'</td>'+
      '<td style="color:'+(atrasada?'var(--red)':'var(--txt2)')+'">'+new Date(c.vencimento+'T12:00:00').toLocaleDateString('pt-BR')+'</td>'+
      '<td><span class="tag '+stClass+'">'+stLabel+'</span></td>'+
      '<td style="display:flex;gap:5px">'+
        (!c.recebido?'<button class="btn sm grn" onclick="receberConta(\''+c.id+'\')">Receber</button>':'')+
        '<button class="btn sm red" onclick="excluirConta(\''+c.id+'\',\'receber\')">Excluir</button>'+
      '</td>'+
    '</tr>'
  }).join('')
}

async function receberConta(id){
  var hoje=new Date().toISOString().slice(0,10)
  await db.from('contas_receber').update({recebido:true,data_recebimento:hoje}).eq('id',id)
  renderContasReceber();toast('Conta marcada como recebida!')
}

// RELATÓRIOS
// TURNO DE CAIXA — abertura/fechamento com contagem + sangrias (retiradas) e suprimentos (reforcos).
// So considera vendas EXATAMENTE "Dinheiro" (PDV) e comandas fechadas "Dinheiro" no calculo do
// esperado — fechamentos de mesa com "Dividir conta" nao entram na parte em dinheiro (mesma
// limitacao do relatorio "Vendas por forma de pagamento": o texto salvo ali e um resumo livre).
var turnoAtual=null
var caixaValorEsperado=0

async function renderCaixa(){
  var el=document.getElementById('caixa-content')
  el.innerHTML='<div class="loading"><div class="spin"></div>Carregando...</div>'
  var res=await scopeCid(db.from('turnos_caixa').select('*')).eq('status','aberto').order('aberto_em',{ascending:false}).limit(1)
  turnoAtual=(res.data&&res.data[0])||null
  if(!turnoAtual){
    el.innerHTML='<div class="mc" style="max-width:420px">'+
      '<div class="lbl">Nenhum caixa aberto</div>'+
      '<p style="font-size:13px;color:var(--txt2);margin:10px 0">Abra o caixa informando o valor inicial (fundo de troco) antes de comecar a vender.</p>'+
      '<div class="fg"><label>Valor de abertura (R$)</label><input type="number" id="caixa-valor-abertura" placeholder="0,00" step="0.01" min="0"></div>'+
      '<button class="btn grn" style="width:100%;justify-content:center;margin-top:10px" onclick="confirmarAberturaCaixa()">&#x1F513; Abrir caixa</button>'+
    '</div>'
    return
  }
  var movRes=await scopeCid(db.from('movimentos_caixa').select('*')).eq('turno_id',turnoAtual.id).order('criado_em',{ascending:false})
  var movs=movRes.data||[]
  var sangrias=movs.filter(function(m){return m.tipo==='sangria'}).reduce(function(a,m){return a+Number(m.valor)},0)
  var suprimentos=movs.filter(function(m){return m.tipo==='suprimento'}).reduce(function(a,m){return a+Number(m.valor)},0)
  el.innerHTML='<div class="mc g" style="max-width:520px;margin-bottom:16px">'+
      '<div class="lbl">Caixa aberto</div>'+
      '<div class="val" style="font-size:16px">Desde '+new Date(turnoAtual.aberto_em).toLocaleString('pt-BR')+'</div>'+
      '<div class="sub">Aberto por '+turnoAtual.usuario_abertura+' &bull; Valor inicial: R$ '+Number(turnoAtual.valor_abertura).toFixed(2)+'</div>'+
    '</div>'+
    '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px">'+
      '<button class="btn red" onclick="abrirMovimentoCaixa(\'sangria\')">&#x2796; Sangria (retirar)</button>'+
      '<button class="btn grn" onclick="abrirMovimentoCaixa(\'suprimento\')">&#x2795; Suprimento (adicionar)</button>'+
      '<button class="btn acc" onclick="abrirFecharCaixa()">&#x1F512; Fechar caixa</button>'+
    '</div>'+
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;max-width:520px">'+
      '<div class="mc r"><div class="lbl">Sangrias no turno</div><div class="val">R$ '+sangrias.toFixed(2)+'</div></div>'+
      '<div class="mc g"><div class="lbl">Suprimentos no turno</div><div class="val">R$ '+suprimentos.toFixed(2)+'</div></div>'+
    '</div>'+
    '<div class="tbl"><table><thead><tr><th>Quando</th><th>Tipo</th><th>Motivo</th><th>Valor</th><th>Quem</th></tr></thead><tbody>'+
    (movs.length?movs.map(function(m){
      return'<tr><td>'+new Date(m.criado_em).toLocaleString('pt-BR')+'</td><td>'+(m.tipo==='sangria'?'&#x2796; Sangria':'&#x2795; Suprimento')+'</td><td>'+(m.motivo||'-')+'</td><td style="font-weight:600">R$ '+Number(m.valor).toFixed(2)+'</td><td>'+(m.usuario_nome||'-')+'</td></tr>'
    }).join(''):'<tr><td colspan="5"><div class="empty">Nenhuma movimentacao nesse turno</div></td></tr>')+
    '</tbody></table></div>'
}

async function confirmarAberturaCaixa(){
  var valor=parseFloat(document.getElementById('caixa-valor-abertura').value)||0
  var res=await db.from('turnos_caixa').insert({cliente_id:meuCid(),usuario_abertura:userLogado.nome,valor_abertura:valor,status:'aberto'}).select().single()
  if(res.error){toast('Erro ao abrir caixa',1);return}
  toast('Caixa aberto!')
  renderCaixa()
}

function abrirMovimentoCaixa(tipo){
  if(!turnoAtual){toast('Nenhum caixa aberto',1);return}
  document.getElementById('mc-titulo').setAttribute('data-tipo',tipo)
  document.getElementById('mc-titulo').innerHTML=tipo==='sangria'?'&#x2796; Sangria (retirar dinheiro)':'&#x2795; Suprimento (adicionar dinheiro)'
  document.getElementById('mc-valor').value=''
  document.getElementById('mc-motivo').value=''
  document.getElementById('ov-movimento-caixa').classList.add('open')
}
async function confirmarMovimentoCaixa(){
  var tipo=document.getElementById('mc-titulo').getAttribute('data-tipo')
  var valor=parseFloat(document.getElementById('mc-valor').value)||0
  var motivo=document.getElementById('mc-motivo').value.trim()
  if(valor<=0){toast('Informe um valor valido',1);return}
  if(!motivo){toast('Informe o motivo',1);return}
  if(!turnoAtual){toast('Nenhum caixa aberto',1);return}
  await db.from('movimentos_caixa').insert({cliente_id:meuCid(),turno_id:turnoAtual.id,tipo:tipo,valor:valor,motivo:motivo,usuario_nome:userLogado.nome})
  registrarExcecao(tipo==='sangria'?'SANGRIA DE CAIXA':'SUPRIMENTO DE CAIXA',motivo+'. Valor: R$ '+valor.toFixed(2),valor)
  closeModals()
  toast(tipo==='sangria'?'Sangria registrada':'Suprimento registrado')
  renderCaixa()
}

async function abrirFecharCaixa(){
  if(!turnoAtual)return
  var vendasRes=await scopeCid(db.from('vendas').select('total')).eq('forma_pagamento','Dinheiro').gte('criado_em',turnoAtual.aberto_em)
  var totalVendasDinheiro=(vendasRes.data||[]).reduce(function(a,v){return a+Number(v.total)},0)
  var mesasRes=await scopeCid(db.from('comandas').select('valor_total')).eq('status','fechada').eq('forma_pagamento','Dinheiro').gte('fechada_em',turnoAtual.aberto_em)
  var totalMesasDinheiro=(mesasRes.data||[]).reduce(function(a,c){return a+Number(c.valor_total||0)},0)
  var movRes=await scopeCid(db.from('movimentos_caixa').select('*')).eq('turno_id',turnoAtual.id)
  var movs=movRes.data||[]
  var sangrias=movs.filter(function(m){return m.tipo==='sangria'}).reduce(function(a,m){return a+Number(m.valor)},0)
  var suprimentos=movs.filter(function(m){return m.tipo==='suprimento'}).reduce(function(a,m){return a+Number(m.valor)},0)
  caixaValorEsperado=Number(turnoAtual.valor_abertura)+totalVendasDinheiro+totalMesasDinheiro+suprimentos-sangrias
  document.getElementById('fc-esperado').textContent='R$ '+caixaValorEsperado.toFixed(2)
  document.getElementById('fc-informado').value=''
  document.getElementById('fc-obs').value=''
  document.getElementById('fc-diferenca-wrap').style.display='none'
  document.getElementById('ov-fechar-caixa').classList.add('open')
}
function calcDiferencaCaixa(){
  var informado=parseFloat(document.getElementById('fc-informado').value)
  var wrap=document.getElementById('fc-diferenca-wrap')
  if(isNaN(informado)){wrap.style.display='none';return}
  var dif=informado-caixaValorEsperado
  wrap.style.display='block'
  var elDif=document.getElementById('fc-diferenca')
  if(Math.abs(dif)<0.005){
    wrap.style.background='var(--green-dim)';elDif.style.color='var(--green)';elDif.textContent='Bateu certinho!'
  } else if(dif>0){
    wrap.style.background='var(--green-dim)';elDif.style.color='var(--green)';elDif.textContent='Sobrou R$ '+dif.toFixed(2)
  } else {
    wrap.style.background='var(--red-dim)';elDif.style.color='var(--red)';elDif.textContent='Faltou R$ '+Math.abs(dif).toFixed(2)
  }
}
async function confirmarFecharCaixa(){
  var informadoRaw=document.getElementById('fc-informado').value
  if(informadoRaw===''){toast('Informe o valor contado no caixa',1);return}
  var informado=parseFloat(informadoRaw)||0
  var dif=informado-caixaValorEsperado
  var obs=document.getElementById('fc-obs').value.trim()
  await db.from('turnos_caixa').update({
    status:'fechado',
    usuario_fechamento:userLogado.nome,
    valor_informado:informado,
    valor_esperado:caixaValorEsperado,
    diferenca:dif,
    fechado_em:new Date().toISOString(),
    observacao:obs||null
  }).eq('id',turnoAtual.id)
  if(Math.abs(dif)>=0.01){
    registrarExcecao('DIFERENCA NO FECHAMENTO DE CAIXA','Esperado: R$ '+caixaValorEsperado.toFixed(2)+'. Contado: R$ '+informado.toFixed(2)+(obs?'. Observação: '+obs:''),dif)
  }
  closeModals()
  toast('Caixa fechado!')
  turnoAtual=null
  renderCaixa()
}

async function renderRelatorio(){
  var tipo=document.getElementById('rel-tipo').value
  var periodo=document.getElementById('rel-periodo').value
  var hoje=new Date()
  var dataInicio
  if(periodo==='dia'){dataInicio=hoje.toISOString().slice(0,10)}
  else if(periodo==='semana'){var s=new Date(hoje);s.setDate(s.getDate()-7);dataInicio=s.toISOString().slice(0,10)}
  else{dataInicio=hoje.toISOString().slice(0,7)+'-01'}
  var el=document.getElementById('rel-content')
  el.innerHTML='<div class="loading"><div class="spin"></div>Carregando...</div>'
  if(tipo==='vendas'){
    var res=await scopeCid(db.from('vendas').select('*')).gte('criado_em',dataInicio).order('criado_em',{ascending:false})
    var vendas=res.data||[]
    var total=vendas.reduce(function(a,v){return a+Number(v.total)},0)
    el.innerHTML='<div class="mc b" style="margin-bottom:16px"><div class="lbl">Total do periodo</div><div class="val">R$ '+total.toFixed(2)+'</div><div class="sub">'+vendas.length+' vendas</div></div>'+
      '<div class="tbl"><table><thead><tr><th>Data/Hora</th><th>Forma</th><th>Total</th></tr></thead><tbody>'+
      (vendas.length?vendas.map(function(v){return'<tr><td>'+new Date(v.criado_em).toLocaleString('pt-BR')+'</td><td>'+v.forma_pagamento+'</td><td style="color:var(--green);font-weight:600">R$ '+Number(v.total).toFixed(2)+'</td></tr>'}).join(''):'<tr><td colspan="3"><div class="empty">Nenhuma venda</div></td></tr>')+
      '</tbody></table></div>'
  } else if(tipo==='vendas_forma'){
    // Agrupa as vendas do PDV (balcao) por forma de pagamento. Obs: fechamentos de mesa com
    // "Dividir conta" nao entram aqui separados por forma (o texto salvo e um resumo livre) —
    // esse relatorio cobre o PDV, que e a maior parte do movimento.
    var res=await scopeCid(db.from('vendas').select('*')).gte('criado_em',dataInicio)
    var vendas=res.data||[]
    var grupos={}
    vendas.forEach(function(v){
      var f=v.forma_pagamento||'Outro'
      if(!grupos[f])grupos[f]={qtd:0,total:0}
      grupos[f].qtd++
      grupos[f].total+=Number(v.total)
    })
    var totalGeral=vendas.reduce(function(a,v){return a+Number(v.total)},0)
    var linhas=Object.keys(grupos).sort(function(a,b){return grupos[b].total-grupos[a].total})
    el.innerHTML='<div class="mc b" style="margin-bottom:16px"><div class="lbl">Total do periodo (PDV)</div><div class="val">R$ '+totalGeral.toFixed(2)+'</div><div class="sub">'+vendas.length+' vendas</div></div>'+
      '<div class="tbl"><table><thead><tr><th>Forma de pagamento</th><th>Qtd vendas</th><th>Total</th><th>% do periodo</th></tr></thead><tbody>'+
      (linhas.length?linhas.map(function(f){
        var g=grupos[f]
        var pct=totalGeral?((g.total/totalGeral)*100).toFixed(1):'0.0'
        return'<tr><td>'+f+'</td><td>'+g.qtd+'</td><td style="color:var(--green);font-weight:600">R$ '+g.total.toFixed(2)+'</td><td>'+pct+'%</td></tr>'
      }).join(''):'<tr><td colspan="4"><div class="empty">Nenhuma venda no periodo</div></td></tr>')+
      '</tbody></table></div>'
  } else if(tipo==='abc'){
    var resV=await scopeCid(db.from('vendas').select('id')).gte('criado_em',dataInicio)
    var vendaIds=(resV.data||[]).map(function(v){return v.id})
    var itens=[]
    if(vendaIds.length){
      var resI=await scopeCid(db.from('itens_venda').select('produto_id,quantidade,preco_unitario')).in('venda_id',vendaIds)
      itens=resI.data||[]
    }
    var porProduto={}
    itens.forEach(function(it){
      if(!it.produto_id)return
      if(!porProduto[it.produto_id])porProduto[it.produto_id]={qtd:0,fat:0}
      porProduto[it.produto_id].qtd+=it.quantidade
      porProduto[it.produto_id].fat+=Number(it.preco_unitario)*it.quantidade
    })
    var lista=Object.keys(porProduto).map(function(pid){
      var p=prods.find(function(x){return x.id===pid})
      var custoUnit=p?Number(p.preco_custo||0):0
      var d=porProduto[pid]
      return{nome:p?p.nome:'Produto removido',qtd:d.qtd,fat:d.fat,lucro:d.fat-(custoUnit*d.qtd)}
    }).sort(function(a,b){return b.fat-a.fat})
    var totalFat=lista.reduce(function(a,x){return a+x.fat},0)
    var acumulado=0
    lista.forEach(function(x){
      acumulado+=x.fat
      x.pctAcum=totalFat?(acumulado/totalFat*100):0
      x.classe=x.pctAcum<=80?'A':x.pctAcum<=95?'B':'C'
    })
    var corClasse={A:'var(--green)',B:'var(--yellow)',C:'var(--red)'}
    el.innerHTML='<div class="mc b" style="margin-bottom:16px"><div class="lbl">Faturamento total (itens vendidos)</div><div class="val">R$ '+totalFat.toFixed(2)+'</div><div class="sub">'+lista.length+' produtos com venda no periodo &bull; A = ~80% do faturamento, B = ~15%, C = resto</div></div>'+
      '<div class="tbl"><table><thead><tr><th>Classe</th><th>Produto</th><th>Qtd vendida</th><th>Faturamento</th><th>Lucro estimado</th><th>% acumulado</th></tr></thead><tbody>'+
      (lista.length?lista.map(function(x){
        return'<tr><td><b style="color:'+corClasse[x.classe]+'">'+x.classe+'</b></td><td>'+x.nome+'</td><td>'+x.qtd+'</td><td style="font-weight:600">R$ '+x.fat.toFixed(2)+'</td><td style="color:'+(x.lucro>=0?'var(--green)':'var(--red)')+'">R$ '+x.lucro.toFixed(2)+'</td><td>'+x.pctAcum.toFixed(1)+'%</td></tr>'
      }).join(''):'<tr><td colspan="6"><div class="empty">Nenhuma venda no periodo</div></td></tr>')+
      '</tbody></table></div>'
  } else if(tipo==='giro'){
    // Nao usa o filtro de periodo de proposito: olha o historico inteiro pra achar a ultima venda de cada produto.
    var resV=await scopeCid(db.from('vendas').select('id,criado_em'))
    var vendasMap={}
    ;(resV.data||[]).forEach(function(v){vendasMap[v.id]=v.criado_em})
    var resI=await scopeCid(db.from('itens_venda').select('produto_id,venda_id'))
    var ultimaVenda={}
    ;(resI.data||[]).forEach(function(it){
      var dt=vendasMap[it.venda_id]
      if(!dt||!it.produto_id)return
      if(!ultimaVenda[it.produto_id]||dt>ultimaVenda[it.produto_id])ultimaVenda[it.produto_id]=dt
    })
    var hoje=new Date()
    var lista=prods.map(function(p){
      var dt=ultimaVenda[p.id]
      var dias=dt?Math.floor((hoje-new Date(dt))/86400000):null
      return{nome:p.nome,estoque:p.estoque,valorParado:p.estoque*Number(p.preco_custo||0),dias:dias}
    }).sort(function(a,b){
      if(a.dias===null&&b.dias===null)return 0
      if(a.dias===null)return -1
      if(b.dias===null)return 1
      return b.dias-a.dias
    })
    var totalParado=lista.reduce(function(a,x){return a+x.valorParado},0)
    el.innerHTML='<div class="mc r" style="margin-bottom:16px"><div class="lbl">Dinheiro parado em estoque (pelo custo)</div><div class="val">R$ '+totalParado.toFixed(2)+'</div><div class="sub">'+lista.length+' produtos cadastrados &bull; considera todo o historico, nao filtra por periodo</div></div>'+
      '<div class="tbl"><table><thead><tr><th>Produto</th><th>Estoque atual</th><th>Valor parado (custo)</th><th>Ultima venda</th></tr></thead><tbody>'+
      (lista.length?lista.map(function(x){
        var txt=x.dias===null?'Nunca vendido':x.dias+' dias atras'
        var cor=(x.dias===null||x.dias>30)?'var(--red)':(x.dias>14?'var(--yellow)':'var(--txt2)')
        return'<tr><td>'+x.nome+'</td><td>'+x.estoque+'</td><td>R$ '+x.valorParado.toFixed(2)+'</td><td style="color:'+cor+';font-weight:600">'+txt+'</td></tr>'
      }).join(''):'<tr><td colspan="4"><div class="empty">Nenhum produto cadastrado</div></td></tr>')+
      '</tbody></table></div>'
  } else if(tipo==='horario'){
    var resV=await scopeCid(db.from('vendas').select('id,criado_em')).gte('criado_em',dataInicio)
    var vendas=resV.data||[]
    var vendaHora={}
    vendas.forEach(function(v){vendaHora[v.id]=new Date(v.criado_em).getHours()})
    var vendaIds=vendas.map(function(v){return v.id})
    var itens=[]
    if(vendaIds.length){
      var resI=await scopeCid(db.from('itens_venda').select('produto_id,quantidade,venda_id')).in('venda_id',vendaIds)
      itens=resI.data||[]
    }
    function faixaHorario(h){
      if(h>=0&&h<6)return'Madrugada (0h-6h)'
      if(h>=6&&h<12)return'Manha (6h-12h)'
      if(h>=12&&h<18)return'Tarde (12h-18h)'
      return'Noite (18h-24h)'
    }
    var porFaixa={}
    itens.forEach(function(it){
      var h=vendaHora[it.venda_id]
      if(h===undefined||!it.produto_id)return
      var f=faixaHorario(h)
      if(!porFaixa[f])porFaixa[f]={}
      if(!porFaixa[f][it.produto_id])porFaixa[f][it.produto_id]=0
      porFaixa[f][it.produto_id]+=it.quantidade
    })
    var ordemFaixas=['Madrugada (0h-6h)','Manha (6h-12h)','Tarde (12h-18h)','Noite (18h-24h)']
    el.innerHTML=ordemFaixas.map(function(f){
      var dados=porFaixa[f]||{}
      var top=Object.keys(dados).map(function(pid){
        var p=prods.find(function(x){return x.id===pid})
        return{nome:p?p.nome:'Produto removido',qtd:dados[pid]}
      }).sort(function(a,b){return b.qtd-a.qtd}).slice(0,5)
      return'<div class="mc" style="margin-bottom:14px"><div class="lbl">'+f+'</div>'+
        (top.length?'<div class="tbl" style="margin-top:8px"><table><thead><tr><th>Produto</th><th>Qtd vendida</th></tr></thead><tbody>'+
          top.map(function(t){return'<tr><td>'+t.nome+'</td><td style="font-weight:600">'+t.qtd+'</td></tr>'}).join('')+
        '</tbody></table></div>':'<div class="empty">Sem vendas nesse horario</div>')+
      '</div>'
    }).join('')
  } else if(tipo==='fechamento_caixa'){
    var res=await scopeCid(db.from('turnos_caixa').select('*')).eq('status','fechado').gte('fechado_em',dataInicio).order('fechado_em',{ascending:false})
    var turnos=res.data||[]
    var totalDif=turnos.reduce(function(a,t){return a+Number(t.diferenca||0)},0)
    el.innerHTML='<div class="mc '+(totalDif<0?'r':'g')+'" style="margin-bottom:16px"><div class="lbl">Diferenca total no periodo</div><div class="val">R$ '+totalDif.toFixed(2)+'</div><div class="sub">'+turnos.length+' turnos fechados</div></div>'+
      '<div class="tbl"><table><thead><tr><th>Aberto</th><th>Fechado</th><th>Abriu</th><th>Fechou</th><th>Valor abertura</th><th>Esperado</th><th>Contado</th><th>Diferenca</th></tr></thead><tbody>'+
      (turnos.length?turnos.map(function(t){
        var dif=Number(t.diferenca||0)
        var cor=Math.abs(dif)<0.005?'var(--txt2)':(dif<0?'var(--red)':'var(--green)')
        return'<tr><td>'+new Date(t.aberto_em).toLocaleString('pt-BR')+'</td><td>'+new Date(t.fechado_em).toLocaleString('pt-BR')+'</td><td>'+t.usuario_abertura+'</td><td>'+(t.usuario_fechamento||'-')+'</td><td>R$ '+Number(t.valor_abertura).toFixed(2)+'</td><td>R$ '+Number(t.valor_esperado||0).toFixed(2)+'</td><td>R$ '+Number(t.valor_informado||0).toFixed(2)+'</td><td style="color:'+cor+';font-weight:600">R$ '+dif.toFixed(2)+'</td></tr>'
      }).join(''):'<tr><td colspan="8"><div class="empty">Nenhum turno fechado no periodo</div></td></tr>')+
      '</tbody></table></div>'
  } else if(tipo==='sangrias'){
    var res=await scopeCid(db.from('movimentos_caixa').select('*')).gte('criado_em',dataInicio).order('criado_em',{ascending:false})
    var movs=res.data||[]
    var sangrias=movs.filter(function(m){return m.tipo==='sangria'}).reduce(function(a,m){return a+Number(m.valor)},0)
    var suprimentos=movs.filter(function(m){return m.tipo==='suprimento'}).reduce(function(a,m){return a+Number(m.valor)},0)
    el.innerHTML='<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">'+
        '<div class="mc r"><div class="lbl">Total em sangrias</div><div class="val">R$ '+sangrias.toFixed(2)+'</div><div class="sub">Retirado do caixa</div></div>'+
        '<div class="mc g"><div class="lbl">Total em suprimentos</div><div class="val">R$ '+suprimentos.toFixed(2)+'</div><div class="sub">Adicionado ao caixa</div></div>'+
      '</div>'+
      '<div class="tbl"><table><thead><tr><th>Quando</th><th>Tipo</th><th>Motivo</th><th>Valor</th><th>Quem</th></tr></thead><tbody>'+
      (movs.length?movs.map(function(m){
        return'<tr><td>'+new Date(m.criado_em).toLocaleString('pt-BR')+'</td><td>'+(m.tipo==='sangria'?'&#x2796; Sangria':'&#x2795; Suprimento')+'</td><td>'+(m.motivo||'-')+'</td><td style="font-weight:600">R$ '+Number(m.valor).toFixed(2)+'</td><td>'+(m.usuario_nome||'-')+'</td></tr>'
      }).join(''):'<tr><td colspan="5"><div class="empty">Nenhuma sangria/suprimento no periodo</div></td></tr>')+
      '</tbody></table></div>'
  } else if(tipo==='mesas'){
    var res=await scopeCid(db.from('comandas').select('*')).eq('status','fechada').gte('fechada_em',dataInicio).order('fechada_em',{ascending:false})
    var fechadas=res.data||[]
    var total=fechadas.reduce(function(a,c){return a+Number(c.valor_total||0)},0)
    el.innerHTML='<div class="mc b" style="margin-bottom:16px"><div class="lbl">Total em mesas no periodo</div><div class="val">R$ '+total.toFixed(2)+'</div><div class="sub">'+fechadas.length+' mesas atendidas</div></div>'+
      '<div class="tbl"><table><thead><tr><th>Fechada em</th><th>Mesa</th><th>Cliente</th><th>Garcom</th><th>Forma</th><th>Total</th></tr></thead><tbody>'+
      (fechadas.length?fechadas.map(function(c){return'<tr><td>'+new Date(c.fechada_em).toLocaleString('pt-BR')+'</td><td>'+c.mesa_numero+'</td><td>'+(c.cliente_nome||'-')+'</td><td>'+(c.garcom_abertura||'-')+'</td><td>'+(c.forma_pagamento||'-')+'</td><td style="color:var(--green);font-weight:600">R$ '+Number(c.valor_total||0).toFixed(2)+'</td></tr>'}).join(''):'<tr><td colspan="6"><div class="empty">Nenhuma mesa atendida no periodo</div></td></tr>')+
      '</tbody></table></div>'
  } else if(tipo==='pix'){
    var res=await scopeCid(db.from('vendas').select('*')).eq('forma_pagamento','PIX').gte('criado_em',dataInicio).order('criado_em',{ascending:false})
    var vendas=res.data||[]
    var total=vendas.reduce(function(a,v){return a+Number(v.total)},0)
    el.innerHTML='<div class="mc b" style="margin-bottom:16px"><div class="lbl">Total PIX no periodo</div><div class="val">R$ '+total.toFixed(2)+'</div><div class="sub">'+vendas.length+' transacoes PIX</div></div>'+
      '<div class="tbl"><table><thead><tr><th>Data/Hora</th><th>Valor</th></tr></thead><tbody>'+
      (vendas.length?vendas.map(function(v){return'<tr><td>'+new Date(v.criado_em).toLocaleString('pt-BR')+'</td><td style="color:var(--green);font-weight:600">R$ '+Number(v.total).toFixed(2)+'</td></tr>'}).join(''):'<tr><td colspan="2"><div class="empty">Nenhuma transacao PIX</div></td></tr>')+
      '</tbody></table></div>'
  } else if(tipo==='pagar'){
    var res=await scopeCid(db.from('contas_pagar').select('*')).gte('vencimento',dataInicio).order('vencimento')
    var contas=res.data||[]
    var total=contas.reduce(function(a,c){return a+Number(c.valor)},0)
    el.innerHTML='<div class="mc r" style="margin-bottom:16px"><div class="lbl">Total a pagar no periodo</div><div class="val">R$ '+total.toFixed(2)+'</div><div class="sub">'+contas.length+' contas</div></div>'+
      '<div class="tbl"><table><thead><tr><th>Descricao</th><th>Categoria</th><th>Valor</th><th>Vencimento</th><th>Status</th></tr></thead><tbody>'+
      (contas.length?contas.map(function(c){return'<tr><td>'+c.descricao+'</td><td>'+c.categoria+'</td><td style="font-weight:600">R$ '+Number(c.valor).toFixed(2)+'</td><td>'+new Date(c.vencimento+'T12:00:00').toLocaleDateString('pt-BR')+'</td><td><span class="tag '+(c.pago?'ok':'out')+'">'+(c.pago?'Pago':'Aberto')+'</span></td></tr>'}).join(''):'<tr><td colspan="5"><div class="empty">Nenhuma conta</div></td></tr>')+
      '</tbody></table></div>'
  } else if(tipo==='excecoes'){
    el.innerHTML='<div class="tbl"><table><thead><tr><th>Data/Hora</th><th>Usuario</th><th>Acao</th><th>Detalhe</th></tr></thead><tbody>'+
      (excecoes.length?excecoes.map(function(e){return'<tr><td>'+e.dt+'</td><td>'+e.user+'</td><td style="color:var(--red)">'+e.acao+'</td><td>'+e.detalhe+'</td></tr>'}).join(''):'<tr><td colspan="4"><div class="empty">Nenhuma excecao registrada</div></td></tr>')+
      '</tbody></table></div>'
  }
}

function printRel(){
  var tipo = document.getElementById('rel-tipo').value
  var el = document.getElementById('rel-content')
  if(!el || !el.innerHTML.trim()){ toast('Carregue um relatorio primeiro', 1); return }
  var loja = localStorage.getItem('nome_loja') || 'ConvenFacil'
  var now = new Date().toLocaleString('pt-BR')
  var titulos = {vendas:'Relatorio de Vendas', vendas_forma:'Vendas por Forma de Pagamento', fechamento_caixa:'Fechamento de Caixa', sangrias:'Sangrias e Suprimentos', mesas:'Relatorio de Mesas Atendidas', pix:'Relatorio PIX', abc:'Curva ABC de Produtos', giro:'Giro de Estoque', horario:'Mais Vendidos por Horario', pagar:'Relatorio Contas a Pagar', excecoes:'Relatorio de Excecoes'}
  var html = '<!DOCTYPE html><html><head><meta charset="UTF-8">'+
    '<style>'+
    'body{font-family:Arial,sans-serif;font-size:12px;color:#000;padding:15px}'+
    'h1{font-size:16px;margin-bottom:4px}'+
    '.sub{font-size:11px;color:#666;margin-bottom:16px}'+
    'table{width:100%;border-collapse:collapse;font-size:12px}'+
    'th{background:#eee;padding:7px;text-align:left;border:1px solid #ddd;font-weight:600}'+
    'td{padding:7px;border:1px solid #ddd}'+
    '.mc{background:#f9f9f9;border:1px solid #ddd;border-radius:6px;padding:12px;margin-bottom:16px;display:inline-block;min-width:200px}'+
    '.mc .lbl{font-size:10px;color:#666;text-transform:uppercase;margin-bottom:4px}'+
    '.mc .val{font-size:20px;font-weight:700}'+
    '@media print{body{padding:5px}}'+
    '</style></head><body>'+
    '<h1>'+loja+': '+(titulos[tipo]||'Relatorio')+'</h1>'+
    '<div class="sub">Gerado em: '+now+'</div>'+
    el.innerHTML+
    '</body></html>'
  imprimirComPreview(html,'Relatorio pronto para impressao')
}

// PRODUTOS
function renderProds(){
  var s=document.getElementById('srch-prods')
  if(s)s.value=''
  drawProds(prods)
}

function drawProds(lista){
  var tb=document.getElementById('pt')
  if(!lista.length){tb.innerHTML='<tr><td colspan="7"><div class="empty">Nenhum produto encontrado</div></td></tr>';return}
  tb.innerHTML=lista.map(function(p){
    var mg=p.preco_custo>0?(((p.preco_venda-p.preco_custo)/p.preco_custo)*100).toFixed(0):0
    var cor=p.estoque===0?'var(--red)':p.estoque<=p.estoque_minimo?'var(--yellow)':'var(--txt1)'
    return'<tr>'+
      '<td><span style="margin-right:7px;font-size:16px">'+(p.emoji||'&#x1F4E6;')+'</span><strong>'+p.nome+'</strong></td>'+
      '<td><span class="tag bl">'+(p.categoria||'-')+'</span></td>'+
      '<td style="color:var(--txt2)">R$ '+Number(p.preco_custo).toFixed(2)+'</td>'+
      '<td style="color:var(--acc);font-weight:600">R$ '+Number(p.preco_venda).toFixed(2)+'</td>'+
      '<td><span class="tag '+(parseInt(mg)>=30?'ok':parseInt(mg)>=15?'low':'out')+'">'+mg+'%</span></td>'+
      '<td style="font-weight:700;color:'+cor+'">'+p.estoque+'</td>'+
      '<td style="display:flex;gap:5px">'+
        (perm('editar')?'<button class="btn sm yellow" onclick="editProd(\''+p.id+'\')">&#x270F; Editar</button>':'')+
        (perm('excluir')?'<button class="btn sm red" onclick="delProd(\''+p.id+'\')">&#x1F5D1;</button>':'')+
      '</td>'+
    '</tr>'
  }).join('')
}

function filterProdsTabela(){
  var q=document.getElementById('srch-prods').value.trim().toLowerCase()
  if(!q){drawProds(prods);return}
  var filtrado=prods.filter(function(p){
    return (p.nome||'').toLowerCase().indexOf(q)>-1||
      (p.categoria||'').toLowerCase().indexOf(q)>-1||
      (p.codigo_barras||'').toLowerCase().indexOf(q)>-1
  })
  drawProds(filtrado)
}

function editProd(id){
  var p=prods.find(function(x){return x.id===id})
  if(!p)return
  document.getElementById('prod-modal-title').textContent='Editar produto'
  document.getElementById('np-id').value=p.id
  document.getElementById('np-n').value=p.nome
  document.getElementById('np-c').value=p.codigo_barras||''
  document.getElementById('np-cat').value=p.categoria||'Bebidas'
  document.getElementById('np-e').value=p.emoji||''
  document.getElementById('np-k').value=p.preco_custo
  document.getElementById('np-v').value=p.preco_venda
  document.getElementById('np-q').value=p.estoque
  document.getElementById('np-m').value=p.estoque_minimo
  document.getElementById('np-val').value=p.validade||''
  document.getElementById('ov-prod').classList.add('open')
}

async function delProd(id){
  if(!perm('excluir')){toast('Sem permissao para excluir',1);return}
  var p=prods.find(function(x){return x.id===id})
  if(!p)return
  confirmDialog('Excluir "'+p.nome+'"?', async function(){
    await db.from('produtos').delete().eq('id',id)
    registrarExcecao('EXCLUSAO DE PRODUTO', p.nome+' - R$ '+Number(p.preco_venda).toFixed(2), p.preco_venda)
    prods=prods.filter(function(x){return x.id!==id});renderProds();renderPDV();renderCats();updateBadge()
    toast('Produto excluido')
  })
}

// CLIENTES FIADO
var clientesFiadoCache=[]

async function renderClientesFiado(){
  var res=await scopeCid(db.from('clientes_fiado').select('*')).order('nome')
  var lista=res.data||[]
  var cr=await scopeCid(db.from('contas_receber').select('cliente_fiado_id,valor')).eq('recebido',false)
  var saldos={}
  ;(cr.data||[]).forEach(function(c){
    if(!c.cliente_fiado_id)return
    saldos[c.cliente_fiado_id]=(saldos[c.cliente_fiado_id]||0)+Number(c.valor)
  })
  clientesFiadoCache=lista.map(function(c){return Object.assign({},c,{saldoFiado:saldos[c.id]||0})})
  document.getElementById('srch-clientes').value=''
  drawClientesFiado(clientesFiadoCache)
}

function drawClientesFiado(lista){
  var tb=document.getElementById('clientes-tb')
  if(!lista.length){tb.innerHTML='<tr><td colspan="5"><div class="empty">Nenhum cliente encontrado</div></td></tr>';return}
  tb.innerHTML=lista.map(function(c){
    var fiado='R$ '+c.saldoFiado.toFixed(2).replace('.',',')
    return'<tr>'+
      '<td><strong>'+c.nome+'</strong></td>'+
      '<td style="color:var(--txt2)">'+( c.telefone||'-')+'</td>'+
      '<td style="color:var(--txt2)">'+( c.cpf||'Nao informado')+'</td>'+
      '<td style="color:'+(c.saldoFiado>0?'var(--red)':'var(--txt2)')+';font-weight:600">'+fiado+'</td>'+
      '<td style="display:flex;gap:5px">'+
        '<button class="btn sm red" onclick="delClienteFiado(\''+ c.id+'\')" >Excluir</button>'+
      '</td>'+
    '</tr>'
  }).join('')
}

function filterClientesFiado(){
  var q=document.getElementById('srch-clientes').value.trim().toLowerCase()
  if(!q){drawClientesFiado(clientesFiadoCache);return}
  var filtrado=clientesFiadoCache.filter(function(c){
    return (c.nome||'').toLowerCase().indexOf(q)>-1||
      (c.telefone||'').toLowerCase().indexOf(q)>-1||
      (c.cpf||'').toLowerCase().indexOf(q)>-1
  })
  drawClientesFiado(filtrado)
}

async function delClienteFiado(id){
  confirmDialog('Excluir este cliente?', async function(){
    await db.from('clientes_fiado').delete().eq('id',id)
    renderClientesFiado()
    toast('Cliente excluido')
  })
}

async function addClienteFiado(){
  var nome=capitalizarNomeProd(document.getElementById('ncf-nome').value.trim())
  var tel=document.getElementById('ncf-tel').value.trim()
  var cpf=document.getElementById('ncf-cpf').value.trim()
  var cep=document.getElementById('ncf-cep').value.trim()
  var end=document.getElementById('ncf-end').value.trim()
  var num=document.getElementById('ncf-num').value.trim()
  var obs=document.getElementById('ncf-obs').value.trim()
  if(!nome){toast('Informe o nome',1);return}
  var res=await db.from('clientes_fiado').insert({nome:nome,telefone:tel,cpf:cpf,cep:cep,endereco:end,numero:num,observacao:obs,cliente_id:meuCid()})
  if(res.error){toast('Erro ao cadastrar cliente',1);return}
  closeModals()
  renderClientesFiado()
  // Recarregar lista no modal de fiado
  carregarClientesFiado()
  toast('Cliente '+nome+' cadastrado com sucesso!')
}

// USUARIOS
var usersCache=[]
async function renderUsers(){
  var res=await scopeCid(db.from('usuarios').select('*')).order('nome')
  usersCache=res.data||[]
  var tb=document.getElementById('users-tb')
  if(!res.data){tb.innerHTML='<tr><td colspan="5"><div class="empty">Erro</div></td></tr>';return}
  var nl={superadmin:'Master',admin:'Administrador',gerente:'Gerente',operador:'Operador'}
  tb.innerHTML=res.data.map(function(u){
    var protegido=u.email==='admin@convenfacil.com.br'||(userLogado&&u.id===userLogado.id)
    return'<tr>'+
      '<td><strong>'+u.nome+'</strong></td>'+
      '<td style="color:var(--txt2)">'+u.email+'</td>'+
      '<td><span class="nivel-badge nivel-'+u.nivel+'">'+(nl[u.nivel]||u.nivel)+'</span></td>'+
      '<td><span class="tag '+(u.ativo?'ok':'out')+'">'+(u.ativo?'Ativo':'Inativo')+'</span></td>'+
      '<td style="display:flex;gap:6px">'+
      (protegido?'':'<button class="btn sm '+(u.ativo?'red':'grn')+'" onclick="toggleUser(\''+u.id+'\','+u.ativo+')">'+(u.ativo?'Desativar':'Ativar')+'</button>'+
        '<button class="btn sm red" onclick="delUsuario(\''+u.id+'\')" title="Excluir usuario">&#x1F5D1;</button>')+
      '</td></tr>'
  }).join('')
}

async function toggleUser(id,ativo){
  await db.from('usuarios').update({ativo:!ativo}).eq('id',id)
  renderUsers();toast('Usuario '+(ativo?'desativado':'ativado'))
}

async function delUsuario(id){
  var u=usersCache.find(function(x){return x.id===id})
  if(!u)return
  if(u.email==='admin@convenfacil.com.br'||(userLogado&&u.id===userLogado.id)){toast('Nao e possivel excluir esse usuario',1);return}
  confirmDialog('Excluir o usuario "'+u.nome+'" ('+u.email+')? Essa acao nao pode ser desfeita.', async function(){
    try{
      await chamarAdminUsers({action:'delete',id:id})
      registrarExcecao('USUARIO EXCLUIDO', u.nome+' ('+u.email+') - nivel '+u.nivel, 0)
      renderUsers()
      toast('Usuario excluido')
    }catch(e){toast(e.message||'Erro ao excluir',1)}
  }, {titulo:'Excluir usuario?', icone:'👤'})
}

// EXCECOES
function renderExceções(){
  var tb=document.getElementById('excecoes-tb')
  if(!excecoes.length){tb.innerHTML='<tr><td colspan="4"><div class="empty">Nenhuma excecao registrada</div></td></tr>';return}
  tb.innerHTML=excecoes.map(function(e,i){
    var temItens=e.itens&&e.itens.length
    var principal='<tr><td>'+e.dt+'</td><td>'+e.user+'</td><td style="color:var(--red);font-weight:600">'+e.acao+'</td><td>'+e.detalhe+
      (temItens?' <button class="btn sm" style="margin-left:6px;padding:2px 8px" onclick="toggleExcecaoItens('+i+')">Ver pedido completo</button>':'')+
      '</td></tr>'
    var detalheItens=''
    if(temItens){
      var linhasItens=e.itens.map(function(it){
        return'<tr><td style="padding:3px 8px;color:var(--txt2)">'+it.qty+'x '+it.nome+'</td><td style="padding:3px 8px;text-align:right;color:var(--txt2)">R$ '+Number(it.subtotal).toFixed(2)+'</td></tr>'
      }).join('')
      detalheItens='<tr id="exc-itens-'+i+'" style="display:none"><td colspan="4" style="background:var(--bg2);padding:8px 12px"><table style="width:100%;font-size:12px">'+linhasItens+'</table></td></tr>'
    }
    return principal+detalheItens
  }).join('')
}

function toggleExcecaoItens(i){
  var row=document.getElementById('exc-itens-'+i)
  if(!row)return
  row.style.display = row.style.display==='none' ? '' : 'none'
}

// SUPER ADMIN
async function renderSuperAdmin(){
  var res=await db.from('clientes').select('*').order('nome')
  var lista=res.data||[]
  document.getElementById('sa-tc').textContent=lista.filter(function(c){return c.ativo}).length
  document.getElementById('sa-tp').textContent=lista.filter(function(c){return c.plano!=='basico'&&c.ativo}).length
  document.getElementById('sa-rec').textContent='R$ '+(lista.filter(function(c){return c.ativo}).length*149).toLocaleString('pt-BR')
  if(!lista.length){document.getElementById('clientes-list').innerHTML='<div class="empty">Nenhum cliente</div>';return}
  var funcs=await Promise.all(lista.map(function(c){return db.from('funcionalidades').select('*').eq('cliente_id',c.id).single()}))
  document.getElementById('clientes-list').innerHTML=lista.map(function(c,i){
    var f=funcs[i].data||{}
    var pc=c.plano==='premium'?'var(--purple)':c.plano==='profissional'?'var(--acc)':'var(--txt2)'
    return'<div class="cliente-card">'+
      '<div class="cliente-header">'+
        '<div class="cliente-info">'+
          '<div class="cliente-avatar">'+c.nome.charAt(0).toUpperCase()+'</div>'+
          '<div><div class="cliente-name">'+c.nome+'</div><div class="cliente-email">'+c.email+' &bull; <span style="color:'+pc+';font-weight:600">'+c.plano.toUpperCase()+'</span></div></div>'+
        '</div>'+
        '<div style="display:flex;gap:7px;align-items:center">'+
          '<span class="tag '+(c.ativo?'ok':'out')+'">'+(c.ativo?'Ativo':'Inativo')+'</span>'+
          '<button class="btn sm" onclick="abrirCriarDono(\''+c.id+'\',\''+c.nome.replace(/'/g,"\\'")+'\')" title="Criar login de admin para o dono dessa loja">&#x1F511; Criar acesso do dono</button>'+
          '<button class="btn sm '+(c.ativo?'red':'grn')+'" onclick="toggleCliente(\''+c.id+'\','+c.ativo+')">'+(c.ativo?'Suspender':'Ativar')+'</button>'+
        '</div>'+
      '</div>'+
      '<div style="font-size:10px;color:var(--txt3);margin-bottom:9px;text-transform:uppercase;letter-spacing:.4px;font-weight:600">Funcionalidades liberadas</div>'+
      '<div class="func-grid">'+
        FUNCIONALIDADES.map(function(fn){
          return'<div class="func-item '+(f[fn.key]?'on':'')+'">'+
            '<div class="func-label"><span>'+fn.ic+'</span>'+fn.label+'</div>'+
            '<label class="toggle">'+
              '<input type="checkbox" '+(f[fn.key]?'checked':'')+' onchange="toggleFunc(\''+c.id+'\',\''+fn.key+'\',this.checked,\''+(f.id||'\'\'')+'\')" >'+
              '<span class="toggle-slider"></span>'+
            '</label>'+
          '</div>'
        }).join('')+
      '</div>'+
    '</div>'
  }).join('')
}

async function toggleFunc(clienteId,funcKey,valor,funcId){
  if(funcId&&funcId!==''){await db.from('funcionalidades').update({[funcKey]:valor}).eq('id',funcId)}
  else{await db.from('funcionalidades').insert({cliente_id:clienteId,[funcKey]:valor})}
  toast((valor?'Liberado: ':'Bloqueado: ')+funcKey)
}

async function toggleCliente(id,ativo){
  await db.from('clientes').update({ativo:!ativo}).eq('id',id)
  renderSuperAdmin();toast('Cliente '+(ativo?'suspenso':'ativado'))
}

// Cria o primeiro login (nivel admin) de uma loja, direto do Painel Master — sem precisar
// de SQL manual. Essa conta so enxerga a propria loja (RLS), nunca o Painel Master.
function abrirCriarDono(clienteId,clienteNome){
  document.getElementById('sao-cliente-id').value=clienteId
  document.getElementById('sao-loja-nome').textContent='Loja: '+clienteNome
  document.getElementById('sao-nome').value=''
  document.getElementById('sao-email').value=''
  document.getElementById('sao-senha').value=''
  document.getElementById('ov-sa-owner').classList.add('open')
}

async function confirmarCriarDono(){
  var clienteId=document.getElementById('sao-cliente-id').value
  var nome=capitalizarNomeProd(document.getElementById('sao-nome').value.trim())
  var email=document.getElementById('sao-email').value.trim()
  var senha=document.getElementById('sao-senha').value
  if(!nome||!email||!senha){toast('Preencha todos os campos',1);return}
  if(senha.length<6){toast('Senha precisa ter pelo menos 6 caracteres',1);return}
  try{
    await chamarAdminUsers({action:'create',nome:nome,email:email,password:senha,nivel:'admin',cliente_id:clienteId})
    closeModals()
    toast('Acesso do dono criado! Anote a senha: '+senha)
  }catch(e){toast(e.message||'Erro ao criar acesso',1)}
}

// MODAIS
function openModal(tipo){
  closeModals()
  if(tipo==='prod'){
    document.getElementById('prod-modal-title').textContent='Cadastrar produto'
    document.getElementById('np-id').value=''
    ;['np-n','np-c','np-e','np-k','np-v','np-q','np-m','np-val'].forEach(function(id){document.getElementById(id).value=''})
  }
  if(tipo==='promo'){
    document.getElementById('promo-modal-title').textContent='Nova promoção'
    document.getElementById('promo-id').value=''
    document.getElementById('promo-prod').innerHTML=prods.map(function(p){return'<option value="'+p.id+'">'+(p.emoji||'')+' '+p.nome+'</option>'}).join('')
    document.getElementById('promo-ate').value=new Date().toISOString().slice(0,10)
    ;['promo-val','promo-desc'].forEach(function(id){document.getElementById(id).value=''})
    switchTab('dados')
    resetCartazModal()
  }
  if(tipo==='pagar')document.getElementById('ncp-venc').value=new Date().toISOString().slice(0,10)
  if(tipo==='receber')document.getElementById('ncr-venc').value=new Date().toISOString().slice(0,10)
  var ov=document.getElementById('ov-'+tipo)
  if(ov)ov.classList.add('open')
}

function closeModals(){
  document.querySelectorAll('.ov').forEach(function(o){o.classList.remove('open')})
}

// Fechar modal ao clicar no overlay
document.addEventListener('click', function(e){
  if(e.target.classList.contains('ov') && e.target.classList.contains('open')){
    e.target.classList.remove('open')
  }
})

// Fechar modal com ESC
document.addEventListener('keydown', function(e){
  if(e.key === 'Escape') closeModals()
})

// Bloqueia F5/Ctrl+R (atualizar a pagina) sem querer — mas SO depois de logado (dentro do
// sistema), pra nao perder um pedido em andamento. Na tela de login (userLogado vazio) o
// F5/Ctrl+R funciona normal — precisa poder atualizar ali (ex: limpar autofill do navegador).
document.addEventListener('keydown', function(e){
  if(!userLogado)return
  if(e.key==='F5'||((e.ctrlKey||e.metaKey)&&(e.key==='r'||e.key==='R'))){
    e.preventDefault()
    toast('Atualizar a pagina fecha o sistema e perde o pedido atual',1)
  }
})

// Se mesmo assim tentar fechar/recarregar por outro caminho (botao do navegador, fechar aba)
// com um pedido em andamento no carrinho, o proprio navegador pergunta antes de sair.
window.addEventListener('beforeunload', function(e){
  if(cart&&cart.length){
    e.preventDefault()
    e.returnValue=''
  }
})

// F10 chama o PDV de qualquer tela do sistema (nao so de dentro do PDV, ao contrario
// dos atalhos F2/F3/F4/F6). F10 nao tem acao padrao no navegador, entao nao chama nada alem disso.
document.addEventListener('keydown', function(e){
  if(e.key==='F10'){
    if(!userLogado||document.querySelector('.ov.open'))return
    e.preventDefault()
    go('pdv',document.getElementById('nav-pdv'))
  }
})

// Atalhos de teclado do PDV — so funcionam com a tela de Caixa aberta e nenhum modal em cima.
// Usei teclas de funcao (F2/F3/F4/F6) de proposito: elas nao digitam nada em campos de texto,
// entao funcionam mesmo com o cursor no campo de busca ou no leitor de codigo de barras.
document.addEventListener('keydown', function(e){
  var secPdv=document.getElementById('sec-pdv')
  var pdvAtivo=secPdv&&secPdv.classList.contains('on')
  if(!pdvAtivo||!userLogado||document.querySelector('.ov.open'))return
  if(e.key==='F2'){
    e.preventDefault()
    var s=document.getElementById('srch')
    if(s){s.focus();s.select()}
  } else if(e.key==='F3'){
    e.preventDefault();toggleBarcode()
  } else if(e.key==='F4'){
    e.preventDefault();abrirResumoPedido()
  } else if(e.key==='F6'){
    e.preventDefault();imprimirCupom()
  } else if(e.ctrlKey&&e.key==='Delete'){
    // Ctrl+Delete de proposito (nao uma tecla solta) pra "Limpar pedido" nao disparar sem querer
    e.preventDefault();clearCart()
  }
})

// Capitaliza nomes de produtos, pessoas e enderecos: primeira letra de cada
// palavra maiuscula, mas particulas (da,de,di,do,das,dos) ficam minusculas
// quando nao estao no inicio da frase. Ex: "joao da silva" -> "Joao da Silva"
var PARTICULAS_MINUSCULAS=['da','de','di','do','das','dos']
function capitalizarNomeProd(s){
  if(!s)return s
  return s.split(/(\s+)/).map(function(parte,i){
    if(/^\s+$/.test(parte))return parte
    var idxPalavra=Math.floor(i/2)
    var low=parte.toLowerCase()
    if(idxPalavra>0 && PARTICULAS_MINUSCULAS.indexOf(low)!==-1)return low
    // capitaliza tambem depois de hifen, ex: "joao-pedro" -> "Joao-Pedro"
    return low.replace(/(^|-)([a-zà-ÿ])/g,function(m,sep,letra){return sep+letra.toUpperCase()})
  }).join('')
}
async function saveProd(){
  var nome=capitalizarNomeProd(document.getElementById('np-n').value.trim())
  if(!nome){toast('Informe o nome',1);return}
  var id=document.getElementById('np-id').value
  var prod={nome:nome,codigo_barras:document.getElementById('np-c').value||null,categoria:document.getElementById('np-cat').value,emoji:document.getElementById('np-e').value||'&#x1F4E6;',preco_custo:parseFloat(document.getElementById('np-k').value)||0,preco_venda:parseFloat(document.getElementById('np-v').value)||0,estoque:parseInt(document.getElementById('np-q').value)||0,estoque_minimo:parseInt(document.getElementById('np-m').value)||5,validade:document.getElementById('np-val').value||null}
  if(id){
    var res=await db.from('produtos').update(prod).eq('id',id).select().single()
    if(res.error){toast('Erro ao atualizar',1);return}
    var idx=prods.findIndex(function(x){return x.id===id})
    if(idx>=0)prods[idx]=res.data
    toast('Produto atualizado!')
  } else {
    prod.cliente_id=meuCid()
    var res=await db.from('produtos').insert(prod).select().single()
    if(res.error){toast('Erro ao cadastrar',1);return}
    prods.push(res.data)
    toast('Produto cadastrado!')
  }
  closeModals();renderPDV();renderCats();renderEstoque();renderProds();updateBadge()
}

async function savePromo(){
  var prod_id=document.getElementById('promo-prod').value
  var tipo=document.getElementById('promo-tipo').value
  var val=parseFloat(document.getElementById('promo-val').value)||0
  var ate=document.getElementById('promo-ate').value
  var desc=document.getElementById('promo-desc').value
  var id=document.getElementById('promo-id').value
  if(!val){toast('Informe o valor',1);return}
  var data={produto_id:prod_id,tipo:tipo,valor:val,valido_ate:ate,descricao:desc}
  if(id){
    await db.from('promocoes').update(data).eq('id',id)
    var idx=promos.findIndex(function(x){return x.id===id})
    if(idx>=0)promos[idx]=Object.assign({id:id},data)
    toast('Promocao atualizada!')
  } else {
    data.cliente_id=meuCid()
    var res=await db.from('promocoes').insert(data).select().single()
    if(res.error){toast('Erro',1);return}
    promos.push(res.data)
    toast('Promocao criada!')
  }
  closeModals();renderPromos();renderPDV()
}

// Criar/apagar usuario agora passa por uma Edge Function (admin-users), que e a unica
// peca do sistema com a chave service_role — a pagina (browser) nunca ve essa chave.
// A funcao confere a sessao de quem esta chamando e so deixa admin/superadmin agir.
async function chamarAdminUsers(payload){
  var{data:sess}=await db.auth.getSession()
  var token=sess&&sess.session&&sess.session.access_token
  var res=await fetch(ADMIN_FN_URL,{
    method:'POST',
    headers:{'Content-Type':'application/json','Authorization':'Bearer '+(token||'')},
    body:JSON.stringify(payload)
  })
  var out=await res.json().catch(function(){return{}})
  if(!res.ok||out.error)throw new Error(out.error||'Erro na operacao')
  return out
}

async function addUser(){
  var nome=capitalizarNomeProd(document.getElementById('nu-nome').value.trim())
  var email=document.getElementById('nu-email').value.trim()
  var senha=document.getElementById('nu-senha').value
  var nivel=document.getElementById('nu-nivel').value
  if(!nome||!email||!senha){toast('Preencha todos os campos',1);return}
  if(senha.length<6){toast('Senha precisa ter pelo menos 6 caracteres',1);return}
  try{
    await chamarAdminUsers({action:'create',nome:nome,email:email,password:senha,nivel:nivel,cliente_id:meuCid()})
    closeModals();renderUsers();toast('Usuario cadastrado!')
  }catch(e){toast(e.message||'Erro ao cadastrar',1)}
}

async function addContaPagar(){
  var desc=document.getElementById('ncp-desc').value.trim()
  var cat=document.getElementById('ncp-cat').value
  var valor=parseFloat(document.getElementById('ncp-valor').value)||0
  var venc=document.getElementById('ncp-venc').value
  var obs=document.getElementById('ncp-obs').value
  if(!desc||!valor||!venc){toast('Preencha todos os campos',1);return}
  var res=await db.from('contas_pagar').insert({descricao:desc,categoria:cat,valor:valor,vencimento:venc,observacao:obs,cliente_id:meuCid()})
  if(res.error){toast('Erro',1);return}
  closeModals();renderContasPagar();toast('Conta a pagar cadastrada!')
}

async function addContaReceber(){
  var desc=document.getElementById('ncr-desc').value.trim()
  var cliente=capitalizarNomeProd(document.getElementById('ncr-cliente').value.trim())
  var valor=parseFloat(document.getElementById('ncr-valor').value)||0
  var venc=document.getElementById('ncr-venc').value
  var obs=document.getElementById('ncr-obs').value
  if(!desc||!cliente||!valor||!venc){toast('Preencha todos os campos',1);return}
  var res=await db.from('contas_receber').insert({descricao:desc,cliente_nome:cliente,valor:valor,vencimento:venc,observacao:obs,cliente_id:meuCid()})
  if(res.error){toast('Erro',1);return}
  closeModals();renderContasReceber();toast('Conta a receber cadastrada!')
}

async function addSaCliente(){
  var nome=capitalizarNomeProd(document.getElementById('nc-nome').value.trim())
  var email=document.getElementById('nc-email').value.trim()
  var tel=document.getElementById('nc-tel').value
  var plano=document.getElementById('nc-plano').value
  if(!nome||!email){toast('Preencha nome e email',1);return}
  var res=await db.from('clientes').insert({nome:nome,email:email,telefone:tel,plano:plano}).select().single()
  if(res.error){toast('Erro',1);return}
  await db.from('funcionalidades').insert({cliente_id:res.data.id,pdv:true,estoque:true,promocoes:false,financeiro:false,relatorios:false,multiplos_caixas:false,impressao_cupom:false,maquininha:false,whatsapp_alertas:false,atendimento_mesas:false})
  closeModals();renderSuperAdmin();toast('Cliente cadastrado!')
}

function imprimirCartazModal(){
  var id=document.getElementById('promo-id').value
  if(id) imprimirCartaz(id, true)
}

// CEP
function mascaraCEP(input){
  var v=input.value.replace(/\D/g,'')
  v=v.replace(/(\d{5})(\d)/,'$1-$2')
  input.value=v
}

async function buscarCEP(){
  var cep=document.getElementById('ncf-cep').value.replace(/\D/g,'')
  if(cep.length!==8)return
  try{
    var res=await fetch('https://viacep.com.br/ws/'+cep+'/json/')
    var data=await res.json()
    if(!data.erro){
      document.getElementById('ncf-end').value=capitalizarNomeProd(data.logradouro+', '+data.bairro+', '+data.localidade)+' - '+data.uf
      toast('Endereço encontrado!')
    } else toast('CEP não encontrado',1)
  }catch(e){toast('Erro ao buscar CEP',1)}
}

// CARTAZ PROMOÇÃO
function imprimirCartaz(promoId, soPreview){
  var pr=promos.find(function(x){return x.id===promoId})
  if(!pr)return
  var p=prods.find(function(x){return x.id===pr.produto_id})
  if(!p)return
  var precoFinal=Number(p.preco_venda)
  if(pr.tipo==='percent')precoFinal=precoFinal*(1-pr.valor/100)
  else if(pr.tipo==='valor')precoFinal=precoFinal-pr.valor
  else precoFinal=pr.valor
  precoFinal=Math.max(0,precoFinal)
  var partes=precoFinal.toFixed(2).split('.')
  var real=partes[0]
  var cents=partes[1]
  var descLabel=pr.tipo==='percent'?pr.valor+'% OFF':pr.tipo==='valor'?'R$ '+Number(pr.valor).toFixed(2)+' OFF':'PRECO ESPECIAL'
  // Carregar configs — do modal se estiver aberto, senao do localStorage
  var modalAberto = document.getElementById('ov-promo').classList.contains('open')
  var cfg = modalAberto ? getCfgCartazModal() : getConfigCartaz()
  var html='<!DOCTYPE html><html><head><meta charset="UTF-8">'+
    '<style>'+
    '@import url(https://fonts.googleapis.com/css2?family=Anton&family=Oswald:wght@400;700&display=swap);'+
    '*{margin:0;padding:0;box-sizing:border-box}'+
    'body{font-family:Oswald,Arial Narrow,Arial,sans-serif;background:#fff;color:#000;width:210mm;min-height:297mm;display:flex;align-items:center;justify-content:center;padding:10mm}'+
    ''.concat('.cartaz{width:190mm;min-height:277mm;border:'+cfg.bordaSize+'px solid '+cfg.corBorda+';padding:12mm;display:flex;flex-direction:column;align-items:center;justify-content:space-between;text-align:center;position:relative}')+''+
    '.preco-area{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;width:100%;padding-bottom:10px}'+
    +
    '.cartaz::before{content:"";position:absolute;inset:4px;border:2px solid '+cfg.corBorda+';pointer-events:none}'+
    '.topo{font-size:28pt;font-weight:700;letter-spacing:4px;color:#cc0000;text-transform:uppercase;border-bottom:3px solid #cc0000;padding-bottom:8px;width:100%;margin-bottom:14px}'+
    '.categoria{font-size:13pt;color:#555;text-transform:uppercase;letter-spacing:3px;margin-bottom:8px}'+
    '.nome{font-family:Anton,Impact,sans-serif;font-size:'+cfg.nomeSize+'pt;color:#000;text-transform:uppercase;line-height:1;margin:10px 0 6px}'+
    '.desc-promo{font-size:14pt;color:#555;margin-bottom:10px;font-style:italic}'+
    '.separador{width:80%;height:3px;background:#cc0000;margin:10px auto}'+
    '.de{font-size:16pt;color:#999;text-decoration:line-through;margin-bottom:4px}'+
    '.badge-desc{background:'+cfg.corBorda+';color:#fff;font-size:'+cfg.descSize+'pt;font-weight:700;padding:6px 24px;display:inline-block;margin:8px 0;letter-spacing:2px}'+
    '.por{font-size:16pt;color:#555;text-transform:uppercase;letter-spacing:2px;margin:8px 0 0}'+
    '.preco-wrap{display:flex;align-items:flex-start;justify-content:center;gap:4px;margin:4px 0 12px}'+
    '.preco-rs{font-size:'+Math.round(cfg.precoSize*0.18)+'pt;font-weight:700;color:'+cfg.corPreco+';margin-top:20px}'+
    '.preco-int{font-family:Anton,Impact,sans-serif;font-size:'+cfg.precoSize+'pt;color:'+cfg.corPreco+';line-height:1;letter-spacing:-8px}'+
    '.preco-cents{font-size:'+Math.round(cfg.precoSize*0.28)+'pt;font-weight:700;color:'+cfg.corPreco+';margin-top:40px}'+
    '.validade{font-size:11pt;color:#888;margin-top:8px;letter-spacing:1px}'+
    '.rodape{font-size:11pt;color:#bbb;letter-spacing:3px;margin-top:10px;border-top:1px solid #ddd;padding-top:8px;width:100%}'+
    '@page{size:A4 portrait;margin:10mm}@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}.no-print{display:none!important}}'+
    '</style></head><body>'+
    '<div class="no-print" style="position:fixed;top:0;left:0;right:0;background:#13161e;padding:12px 18px;display:flex;align-items:center;justify-content:space-between;z-index:999;border-bottom:1px solid #2e3548;font-family:system-ui,-apple-system,sans-serif;box-shadow:0 4px 24px rgba(0,0,0,.4)">'+
      '<span style="color:#fff;font-size:13px;font-weight:700">&#x1F5A8; Cartaz pronto para impressao</span>'+
      '<div style="display:flex;gap:10px">'+
        '<button onclick="window.close()" style="padding:9px 18px;background:#222736;color:#fff;border:1px solid #3a4260;border-radius:10px;font-size:13px;font-weight:500;cursor:pointer;font-family:inherit">Fechar</button>'+
        '<button onclick="window.print()" style="padding:9px 22px;background:#3ecf8e;color:#0d0f14;border:1px solid #3ecf8e;border-radius:10px;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit">&#x2705; Imprimir agora</button>'+
      '</div>'+
    '</div>'+
    '<div style="height:56px" class="no-print"></div>'+
    '<div class="cartaz">'+
      '<div style="width:100%">'+
        '<div class="topo">&#x2605; '+cfg.topo+' &#x2605;</div>'+
        '<div class="categoria">'+(p.categoria||'Oferta especial')+'</div>'+
        '<div class="nome">'+p.nome+'</div>'+
        (pr.descricao?'<div class="desc-promo">'+pr.descricao+'</div>':'')+
        '<div class="separador"></div>'+
      '</div>'+
      '<div class="preco-area">'+
        (pr.tipo!=='preco'?'<div class="de">De R$ '+Number(p.preco_venda).toFixed(2)+'</div>':'')+
        '<div class="badge-desc">'+descLabel+'</div>'+
        '<div class="por">Por apenas</div>'+
        '<div class="preco-wrap">'+
          '<span class="preco-rs">R$</span>'+
          '<span class="preco-int">'+real+'</span>'+
          '<span class="preco-cents">,'+cents+'</span>'+
        '</div>'+
        '<div class="validade">Válido até '+new Date(pr.valido_ate+'T12:00:00').toLocaleDateString('pt-BR')+'</div>'+
      '</div>'+
      '<div class="rodape">CONVÊNFÁCIL. '+new Date().toLocaleDateString('pt-BR')+'</div>'+
    '</div>'+
    '<script>window.onafterprint=function(){window.close()}<\/script>'+
    '</body></html>'
  var w=window.open('','_blank','width=800,height=1100')
  w.document.write(html)
  w.document.close()
  if(!soPreview) setTimeout(function(){w.print()},1000)
}

// CONFIGURACOES
function carregarConfigs(){
  var campos={
    'cfg-nome':'nome_loja',
    'cfg-cnpj':'cnpj_loja',
    'cfg-tel':'tel_loja',
    'cfg-end':'end_loja',
    'cfg-cidade':'cidade_loja',
    'cfg-pix':'chave_pix',
    'cfg-pix-tipo':'tipo_pix',
    'cfg-pix-nome':'nome_pix',
    'cfg-rodape':'rodape_cupom'
  }
  Object.keys(campos).forEach(function(id){
    var el=document.getElementById(id)
    if(el){var val=localStorage.getItem(campos[id]);if(val)el.value=val}
  })
  atualizarStatusConfigs()
}

function carregarConfigCartaz(){
  var cfg = getConfigCartaz()
  var d = CFG_CARTAZ_DEFAULTS
  var topo = document.getElementById('cfg-cartaz-topo')
  if(topo) topo.value = cfg.topo
  var ns = document.getElementById('cfg-cartaz-nome-size')
  if(ns){ ns.value = cfg.nomeSize; document.getElementById('cfg-cartaz-nome-val').textContent = cfg.nomeSize+'pt' }
  var ps = document.getElementById('cfg-cartaz-preco-size')
  if(ps){ ps.value = cfg.precoSize; document.getElementById('cfg-cartaz-preco-val').textContent = cfg.precoSize+'pt' }
  var ds = document.getElementById('cfg-cartaz-desc-size')
  if(ds){ ds.value = cfg.descSize; document.getElementById('cfg-cartaz-desc-val').textContent = cfg.descSize+'pt' }
  var bs = document.getElementById('cfg-cartaz-borda-size')
  if(bs){ bs.value = cfg.bordaSize; document.getElementById('cfg-cartaz-borda-val').textContent = cfg.bordaSize+'px' }
  var cb = document.getElementById('cfg-cartaz-cor-borda')
  if(cb) cb.value = cfg.corBorda
  var cp = document.getElementById('cfg-cartaz-cor-preco')
  if(cp) cp.value = cfg.corPreco
}

function atualizarStatusConfigs(){
  var nome=localStorage.getItem('nome_loja')
  var cnpj=localStorage.getItem('cnpj_loja')
  var pix=localStorage.getItem('chave_pix')
  var sn=document.getElementById('cfg-status-nome')
  var sc=document.getElementById('cfg-status-cnpj')
  var sp=document.getElementById('cfg-status-pix')
  if(sn){sn.textContent=nome?nome:'Nao configurado';sn.className='tag '+(nome?'ok':'out')}
  if(sc){sc.textContent=cnpj?cnpj:'Nao configurado';sc.className='tag '+(cnpj?'ok':'out')}
  if(sp){sp.textContent=pix?pix:'Nao configurado';sp.className='tag '+(pix?'ok':'out')}
}

function salvarConfigLoja(){
  localStorage.setItem('nome_loja',capitalizarNomeProd(document.getElementById('cfg-nome').value.trim()))
  localStorage.setItem('cnpj_loja',document.getElementById('cfg-cnpj').value)
  localStorage.setItem('tel_loja',document.getElementById('cfg-tel').value)
  localStorage.setItem('end_loja',capitalizarNomeProd(document.getElementById('cfg-end').value.trim()))
  localStorage.setItem('cidade_loja',capitalizarNomeProd(document.getElementById('cfg-cidade').value.trim()))
  atualizarStatusConfigs()
  toast('Dados da loja salvos!')
}

function salvarConfigPix(){
  localStorage.setItem('chave_pix',document.getElementById('cfg-pix').value)
  localStorage.setItem('tipo_pix',document.getElementById('cfg-pix-tipo').value)
  localStorage.setItem('nome_pix',document.getElementById('cfg-pix-nome').value)
  atualizarStatusConfigs()
  toast('Configuracao PIX salva!')
}

function salvarConfigImpressao(){
  localStorage.setItem('rodape_cupom',document.getElementById('cfg-rodape').value)
  toast('Configuracao de impressao salva!')
}

// ABAS DO MODAL PROMO
function atualizarPreviewCartaz(){
  var promoId = document.getElementById('promo-id').value
  var cfg = getCfgCartazModal()
  var pr = promos.find(function(x){return x.id===promoId})
  var p = pr ? prods.find(function(x){return x.id===pr.produto_id}) : null

  // Se nao tem promo salva, usar dados do form
  var nomeProd = p ? p.nome : (document.getElementById('promo-prod').options[document.getElementById('promo-prod').selectedIndex]||{}).text || 'Nome do Produto'
  var emoji = p ? (p.emoji||'') : ''
  var precoFinal = 9.99
  var descLabel = 'DESCONTO'
  var precoOriginal = null

  if(pr && p){
    precoFinal = Number(p.preco_venda)
    if(pr.tipo==='percent'){precoFinal=precoFinal*(1-pr.valor/100);descLabel=pr.valor+'% OFF';precoOriginal=Number(p.preco_venda)}
    else if(pr.tipo==='valor'){precoFinal=precoFinal-pr.valor;descLabel='R$ '+Number(pr.valor).toFixed(2)+' OFF';precoOriginal=Number(p.preco_venda)}
    else{precoFinal=pr.valor;descLabel='PRECO ESPECIAL'}
    precoFinal=Math.max(0,precoFinal)
  }

  var partes = precoFinal.toFixed(2).split('.')
  var real = partes[0], cents = partes[1]

  var html = '<div style="'+
    'font-family:Oswald,Arial,sans-serif;'+
    'background:#fff;color:#000;'+
    'padding:20px;'+
    'border:'+cfg.bordaSize+'px solid '+cfg.corBorda+';'+
    'position:relative;'+
    'min-height:560px;'+
    'display:flex;flex-direction:column;align-items:center;justify-content:space-between;text-align:center'+
    '">'+
    '<div style="position:absolute;inset:4px;border:2px solid '+cfg.corBorda+';pointer-events:none"></div>'+
    '<div style="width:100%;position:relative;z-index:1">'+
      '<div style="font-size:20px;font-weight:700;letter-spacing:3px;color:'+cfg.corBorda+';text-transform:uppercase;border-bottom:3px solid '+cfg.corBorda+';padding-bottom:6px;margin-bottom:10px">&#x2605; '+cfg.topo+' &#x2605;</div>'+
      '<div style="font-size:13px;color:#555;text-transform:uppercase;letter-spacing:2px;margin-bottom:6px">'+(p?p.categoria||'Produto':'Categoria')+'</div>'+
      '<div style="font-family:Anton,Impact,sans-serif;font-size:'+cfg.nomeSize+'px;color:#000;text-transform:uppercase;line-height:1;margin:8px 0">'+nomeProd+'</div>'+
      '<div style="border-top:2px solid '+cfg.corBorda+';margin:10px auto;width:80%"></div>'+
    '</div>'+
    '<div style="width:100%;position:relative;z-index:1">'+
      (precoOriginal?'<div style="font-size:16px;color:#999;text-decoration:line-through;margin-bottom:4px">De R$ '+precoOriginal.toFixed(2)+'</div>':'')+
      '<div style="background:'+cfg.corBorda+';color:#fff;font-size:'+cfg.descSize+'px;font-weight:700;padding:5px 20px;display:inline-block;margin:6px 0;letter-spacing:1px">'+descLabel+'</div>'+
      '<div style="color:#555;font-size:13px;text-transform:uppercase;letter-spacing:1px;margin:4px 0">Por apenas</div>'+
      '<div style="display:flex;align-items:flex-start;justify-content:center;gap:2px">'+
        '<span style="font-size:'+Math.round(cfg.precoSize*0.18)+'px;font-weight:700;color:'+cfg.corPreco+';margin-top:'+Math.round(cfg.precoSize*0.06)+'px">R$</span>'+
        '<span style="font-family:Anton,Impact,sans-serif;font-size:'+cfg.precoSize+'px;color:'+cfg.corPreco+';line-height:1;letter-spacing:-2px">'+real+'</span>'+
        '<span style="font-size:'+Math.round(cfg.precoSize*0.28)+'px;font-weight:700;color:'+cfg.corPreco+';margin-top:'+Math.round(cfg.precoSize*0.06)+'px">,'+cents+'</span>'+
      '</div>'+
    '</div>'+
    '<div style="font-size:10px;color:#bbb;letter-spacing:2px;border-top:1px solid #ddd;padding-top:6px;width:100%;position:relative;z-index:1">CONVÊNFÁCIL</div>'+
  '</div>'

  var el = document.getElementById('cartaz-preview')
  var spacer = document.getElementById('cartaz-preview-spacer')
  if(el){
    el.innerHTML = html
    // Ajustar altura do spacer para o conteudo escalado
    setTimeout(function(){
      var h = el.scrollHeight * 0.35
      spacer.style.height = h + 'px'
      el.style.minHeight = 'auto'
    }, 50)
  }
}

function switchTab(tab){
  var isCartaz = tab === 'cartaz'
  document.getElementById('tab-dados').style.display = isCartaz ? 'none' : 'block'
  document.getElementById('tab-cartaz').style.display = isCartaz ? 'block' : 'none'
  document.getElementById('tab-dados-btn').style.borderBottomColor = isCartaz ? 'transparent' : 'var(--acc)'
  document.getElementById('tab-dados-btn').style.color = isCartaz ? 'var(--txt2)' : 'var(--acc)'
  document.getElementById('tab-cartaz-btn').style.borderBottomColor = isCartaz ? 'var(--acc)' : 'transparent'
  document.getElementById('tab-cartaz-btn').style.color = isCartaz ? 'var(--acc)' : 'var(--txt2)'
  if(isCartaz) setTimeout(atualizarPreviewCartaz, 100)
}

function resetCartazModal(){
  document.getElementById('cartaz-topo').value = 'Promoção do Dia'
  document.getElementById('cartaz-nome-size').value = 52
  document.getElementById('cartaz-nome-val').textContent = '52pt'
  document.getElementById('cartaz-preco-size').value = 260
  document.getElementById('cartaz-preco-val').textContent = '260pt'
  document.getElementById('cartaz-desc-size').value = 22
  document.getElementById('cartaz-desc-val').textContent = '22pt'
  document.getElementById('cartaz-borda-size').value = 8
  document.getElementById('cartaz-borda-val').textContent = '8px'
  document.getElementById('cartaz-cor-borda').value = '#cc0000'
  document.getElementById('cartaz-cor-preco').value = '#cc0000'
  toast('Padroes restaurados!')
}

function getCfgCartazModal(){
  return {
    topo: document.getElementById('cartaz-topo').value || 'Promoção do Dia',
    nomeSize: parseInt(document.getElementById('cartaz-nome-size').value) || 52,
    precoSize: parseInt(document.getElementById('cartaz-preco-size').value) || 260,
    descSize: parseInt(document.getElementById('cartaz-desc-size').value) || 22,
    bordaSize: parseInt(document.getElementById('cartaz-borda-size').value) || 8,
    corBorda: document.getElementById('cartaz-cor-borda').value || '#cc0000',
    corPreco: document.getElementById('cartaz-cor-preco').value || '#cc0000'
  }
}

function previewCartazModal(){
  var promoId = document.getElementById('promo-id').value
  if(!promoId){ toast('Salve a promoção primeiro para pre-visualizar', 1); return }
  imprimirCartaz(promoId, true)
}

// CONFIGS DO CARTAZ
var CFG_CARTAZ_DEFAULTS = {
  topo: 'Promoção do Dia',
  nomeSize: 52,
  precoSize: 260,
  descSize: 22,
  bordaSize: 8,
  corBorda: '#cc0000',
  corPreco: '#cc0000'
}

function getConfigCartaz(){
  return {
    topo: localStorage.getItem('cartaz_topo') || CFG_CARTAZ_DEFAULTS.topo,
    nomeSize: parseInt(localStorage.getItem('cartaz_nome_size')) || CFG_CARTAZ_DEFAULTS.nomeSize,
    precoSize: parseInt(localStorage.getItem('cartaz_preco_size')) || CFG_CARTAZ_DEFAULTS.precoSize,
    descSize: parseInt(localStorage.getItem('cartaz_desc_size')) || CFG_CARTAZ_DEFAULTS.descSize,
    bordaSize: parseInt(localStorage.getItem('cartaz_borda_size')) || CFG_CARTAZ_DEFAULTS.bordaSize,
    corBorda: localStorage.getItem('cartaz_cor_borda') || CFG_CARTAZ_DEFAULTS.corBorda,
    corPreco: localStorage.getItem('cartaz_cor_preco') || CFG_CARTAZ_DEFAULTS.corPreco
  }
}

function salvarConfigCartaz(){
  localStorage.setItem('cartaz_topo', document.getElementById('cfg-cartaz-topo').value || CFG_CARTAZ_DEFAULTS.topo)
  localStorage.setItem('cartaz_nome_size', document.getElementById('cfg-cartaz-nome-size').value)
  localStorage.setItem('cartaz_preco_size', document.getElementById('cfg-cartaz-preco-size').value)
  localStorage.setItem('cartaz_desc_size', document.getElementById('cfg-cartaz-desc-size').value)
  localStorage.setItem('cartaz_borda_size', document.getElementById('cfg-cartaz-borda-size').value)
  localStorage.setItem('cartaz_cor_borda', document.getElementById('cfg-cartaz-cor-borda').value)
  localStorage.setItem('cartaz_cor_preco', document.getElementById('cfg-cartaz-cor-preco').value)
  toast('Configuracao do cartaz salva!')
}

function resetConfigCartaz(){
  var d = CFG_CARTAZ_DEFAULTS
  document.getElementById('cfg-cartaz-topo').value = d.topo
  document.getElementById('cfg-cartaz-nome-size').value = d.nomeSize
  document.getElementById('cfg-cartaz-nome-val').textContent = d.nomeSize+'pt'
  document.getElementById('cfg-cartaz-preco-size').value = d.precoSize
  document.getElementById('cfg-cartaz-preco-val').textContent = d.precoSize+'pt'
  document.getElementById('cfg-cartaz-desc-size').value = d.descSize
  document.getElementById('cfg-cartaz-desc-val').textContent = d.descSize+'pt'
  document.getElementById('cfg-cartaz-borda-size').value = d.bordaSize
  document.getElementById('cfg-cartaz-borda-val').textContent = d.bordaSize+'px'
  document.getElementById('cfg-cartaz-cor-borda').value = d.corBorda
  document.getElementById('cfg-cartaz-cor-preco').value = d.corPreco
  // Limpar localStorage
  ['cartaz_topo','cartaz_nome_size','cartaz_preco_size','cartaz_desc_size','cartaz_borda_size','cartaz_cor_borda','cartaz_cor_preco'].forEach(function(k){localStorage.removeItem(k)})
  toast('Configuracoes restauradas para o padrao!')
}

function previewCartaz(){
  // Usar primeiro produto com promocao ou produto de exemplo
  var pr = promos[0]
  var p = pr ? prods.find(function(x){return x.id===pr.produto_id}) : null
  if(!pr || !p){
    toast('Cadastre uma promocao para pre-visualizar',1)
    return
  }
  imprimirCartaz(pr.id, true)
}

// MASCARA CNPJ
function mascaraCNPJ(input){
  var v=input.value.replace(/\D/g,'')
  v=v.replace(/(\d{2})(\d)/,'$1.$2')
  v=v.replace(/(\d{3})(\d)/,'$1.$2')
  v=v.replace(/(\d{3})(\d)/,'$1/$2')
  v=v.replace(/(\d{4})(\d{1,2})$/,'$1-$2')
  input.value=v
}

// CPF
function mascaraCPF(input){
  var v = input.value.replace(/\D/g,'')
  v = v.replace(/(\d{3})(\d)/,'$1.$2')
  v = v.replace(/(\d{3})(\d)/,'$1.$2')
  v = v.replace(/(\d{3})(\d{1,2})$/,'$1-$2')
  input.value = v
}

function validarCPF(input){
  var cpf = input.value.replace(/\D/g,'')
  if(cpf.length !== 11){
    if(cpf.length > 0){input.style.borderColor='var(--red)';toast('CPF invalido',1)}
    return false
  }
  // Verifica digitos iguais
  if(/^(\d)\1{10}$/.test(cpf)){input.style.borderColor='var(--red)';toast('CPF invalido',1);return false}
  // Valida digitos verificadores
  var soma=0
  for(var i=0;i<9;i++) soma+=parseInt(cpf[i])*(10-i)
  var r=11-(soma%11)
  if(r>=10) r=0
  if(r!==parseInt(cpf[9])){input.style.borderColor='var(--red)';toast('CPF invalido',1);return false}
  soma=0
  for(var i=0;i<10;i++) soma+=parseInt(cpf[i])*(11-i)
  r=11-(soma%11)
  if(r>=10) r=0
  if(r!==parseInt(cpf[10])){input.style.borderColor='var(--red)';toast('CPF invalido',1);return false}
  input.style.borderColor='var(--green)'
  toast('CPF valido!')
  return true
}

// TROCO
// valorOverride: usado pela "Dividir conta" pra calcular troco so da fatia (valor parcial) que
// essa pessoa especifica esta pagando em dinheiro, em vez do total inteiro da comanda/carrinho.
function abrirTroco(valorOverride){
  var total = valorOverride!=null ? valorOverride : totalParaPagamento()
  document.getElementById('troco-total-display').textContent = 'R$ ' + total.toFixed(2)
  document.getElementById('troco-valor-modal').value = ''
  document.getElementById('troco-resultado-wrap').style.display = 'none'
  document.getElementById('troco-insuficiente').style.display = 'none'
  closeModals()
  document.getElementById('ov-troco').classList.add('open')
  setTimeout(function(){ document.getElementById('troco-valor-modal').focus() }, 200)
}

function calcTrocoModal(){
  var total = (divisaoEmAndamento&&divisaoLinhaPendente) ? divisaoLinhaPendente.valor : totalParaPagamento()
  var recebido = parseFloat(document.getElementById('troco-valor-modal').value) || 0
  var troco = recebido - total
  var wrapEl = document.getElementById('troco-resultado-wrap')
  var insufEl = document.getElementById('troco-insuficiente')
  var btnEl = document.getElementById('btn-confirmar-troco')
  if(recebido === 0){ wrapEl.style.display='none'; insufEl.style.display='none'; return }
  if(troco < 0){
    wrapEl.style.display = 'none'
    insufEl.style.display = 'block'
    document.getElementById('troco-falta').textContent = 'R$ ' + Math.abs(troco).toFixed(2)
    btnEl.disabled = true
    btnEl.style.opacity = '.4'
  } else {
    wrapEl.style.display = 'block'
    insufEl.style.display = 'none'
    document.getElementById('troco-valor-resultado').textContent = 'R$ ' + troco.toFixed(2)
    btnEl.disabled = false
    btnEl.style.opacity = '1'
  }
}

function confirmarTroco(){
  var total = (divisaoEmAndamento&&divisaoLinhaPendente) ? divisaoLinhaPendente.valor : totalParaPagamento()
  var recebido = parseFloat(document.getElementById('troco-valor-modal').value) || 0
  if(recebido < total){ toast('Valor insuficiente!', 1); return }
  closeModals()
  if(divisaoEmAndamento&&divisaoLinhaPendente){
    empurrarLinhaDivisao(divisaoLinhaPendente)
    divisaoLinhaPendente=null
    divisaoEmAndamento=false
    return
  }
  confirmarPay('Dinheiro')
}

// Cancela o PIX/Troco que estava sendo processado pra uma linha da "Dividir conta" e volta
// pro modal de divisao sem perder o que ja tinha sido adicionado. Fora da divisao, comporta-se
// como antes (volta pro resumo do pedido ou pro fechamento de mesa).
function cancelarPagamentoParcial(){
  closeModals()
  if(divisaoEmAndamento){
    divisaoEmAndamento=false
    divisaoLinhaPendente=null
    document.getElementById('ov-dividir-pagamento').classList.add('open')
    return
  }
  voltarPagamento()
}

function confirmarRecebimentoPIX(){
  closeModals()
  if(divisaoEmAndamento&&divisaoLinhaPendente){
    empurrarLinhaDivisao(divisaoLinhaPendente)
    divisaoLinhaPendente=null
    divisaoEmAndamento=false
    return
  }
  confirmarPay('PIX')
}

// RESUMO DO PEDIDO
function abrirResumoPedido(){
  if(!cart.length){ toast('Adicione produtos ao pedido', 1); return }
  var orig = cart.reduce(function(a,c){ return a + Number(c.preco_venda)*c.qty }, 0)
  var total = cart.reduce(function(a,c){ return a + Number(c.preco_final)*c.qty }, 0)
  var desc = orig - total
  // Preencher itens
  document.getElementById('resumo-itens').innerHTML = cart.map(function(c){
    return '<div class="ri">'+
      '<span style="font-size:20px">'+( c.emoji||'&#x1F4E6;')+'</span>'+
      '<div style="flex:1;min-width:0">'+
        '<div style="font-size:13px;font-weight:500">'+c.nome+'</div>'+
        '<div style="font-size:11px;color:var(--txt3)">'+c.qty+' x R$ '+Number(c.preco_final).toFixed(2)+'</div>'+
      '</div>'+
      '<div style="font-size:14px;font-weight:700;color:var(--acc)">R$ '+(Number(c.preco_final)*c.qty).toFixed(2)+'</div>'+
      '<button class="ri-del" title="Excluir item" onclick="delResumoItem(\''+c.id+'\')">&#x2716;</button>'+
    '</div>'
  }).join('')
  document.getElementById('resumo-sub').textContent = 'R$ ' + orig.toFixed(2)
  document.getElementById('resumo-desc').textContent = desc > 0 ? '- R$ ' + desc.toFixed(2) : 'R$ 0,00'
  document.getElementById('resumo-total').textContent = 'R$ ' + total.toFixed(2)
  document.getElementById('ov-resumo').classList.add('open')
}

function delResumoItem(id){
  var i = cart.findIndex(function(x){ return x.id === id })
  if(i < 0) return
  var nome = cart[i].nome
  confirmDialog('Excluir "'+nome+'" do pedido?', function(){
    var j = cart.findIndex(function(x){ return x.id === id })
    if(j < 0) return
    cart.splice(j, 1)
    renderCart()
    if(!cart.length){
      toast('Pedido esvaziado', 1)
      return
    }
    abrirResumoPedido()
  }, {titulo:'Excluir item?', icone:'🗑️'})
}

// CAMERA LEITOR
var html5QrCode = null
var html5QrCodeModal = null

function toggleCamera(){
  var area = document.getElementById('camera-area')
  if(area.style.display === 'none'){
    area.style.display = 'block'
    iniciarCamera('camera-reader')
  } else {
    pararCamera()
  }
}

function iniciarCamera(elementId){
  try {
    if(html5QrCode) html5QrCode.stop()
    html5QrCode = new Html5Qrcode(elementId)
    html5QrCode.start(
      {facingMode:'environment'},
      {fps:10, qrbox:{width:250, height:150}},
      function(decodedText){
        var p = prods.find(function(x){ return x.codigo_barras === decodedText })
        if(p){ addCart(p.id, Number(p.preco_venda)); toast((p.emoji||'') + ' ' + p.nome + ' adicionado!') }
        else toast('Produto nao encontrado: ' + decodedText, 1)
      },
      function(err){}
    ).catch(function(e){ toast('Erro ao acessar camera: ' + e, 1) })
  } catch(e){ toast('Camera nao disponivel', 1) }
}

function pararCamera(){
  if(html5QrCode){ html5QrCode.stop().catch(function(){}) }
  document.getElementById('camera-area').style.display = 'none'
}

function pararCameraModal(){
  if(html5QrCodeModal){ html5QrCodeModal.stop().catch(function(){}) }
  closeModals()
}

// PIX QR CODE
// valorOverride: usado pela "Dividir conta" pra gerar o QR so da fatia (valor parcial) que essa
// pessoa especifica esta pagando via PIX, em vez do total inteiro da comanda/carrinho.
function abrirPIX(valorOverride){
  if(valorOverride==null && !mesaPagamentoAtivo && !cart.length){ toast('Adicione produtos ao pedido', 1); return }
  var total = valorOverride!=null ? valorOverride : totalParaPagamento()
  document.getElementById('pix-total').textContent = 'R$ ' + total.toFixed(2)
  // Chave PIX salva no localStorage
  var chavePix = localStorage.getItem('chave_pix') || 'convenfacil@NinjAI'
  document.getElementById('pix-chave-display').textContent = chavePix
  // Gerar payload PIX (formato EMV)
  var payload = gerarPayloadPIX(chavePix, total)
  // Gerar QR Code
  var canvas = document.getElementById('pix-qrcode')
  QRCode.toCanvas(canvas, payload, {width: 220, margin: 2, color:{dark:'#000000', light:'#ffffff'}}, function(err){
    if(err) console.error(err)
  })
  document.getElementById('ov-pix').classList.add('open')
}

function gerarPayloadPIX(chave, valor){
  // Formato simplificado EMV QRCPS
  var valorStr = valor.toFixed(2)
  var nome = 'CONVENFACIL'
  var cidade = 'SAO PAULO'
  function campo(id, val){ var s = String(val); return id + s.length.toString().padStart(2,'0') + s }
  var merchantAccountInfo = campo('00','BR.GOV.BCB.PIX') + campo('01', chave)
  var payload =
    campo('00','01') +
    campo('26', merchantAccountInfo) +
    campo('52','0000') +
    campo('53','986') +
    campo('54', valorStr) +
    campo('58','BR') +
    campo('59', nome.substring(0,25)) +
    campo('60', cidade.substring(0,15)) +
    campo('62', campo('05','***'))
  // CRC16
  payload += '6304'
  var crc = crc16(payload)
  return payload + crc.toString(16).toUpperCase().padStart(4,'0')
}

function crc16(str){
  var crc = 0xFFFF
  for(var i=0; i<str.length; i++){
    crc ^= str.charCodeAt(i) << 8
    for(var j=0; j<8; j++){
      if(crc & 0x8000) crc = (crc << 1) ^ 0x1021
      else crc <<= 1
    }
  }
  return crc & 0xFFFF
}

function copiarPIX(){
  var chave = localStorage.getItem('chave_pix') || 'convenfacil@NinjAI'
  navigator.clipboard.writeText(chave).then(function(){
    toast('Chave PIX copiada!')
  }).catch(function(){
    toast('Erro ao copiar', 1)
  })
}

// CUPOM TERMICO
function imprimirCupom(){
  var itens = cart.length ? cart : cartSnapshot
  if(!itens || !itens.length){ toast('Adicione produtos ao pedido', 1); return }
  var total = itens.reduce(function(a,c){ return a + Number(c.preco_final)*c.qty }, 0)
  var orig = itens.reduce(function(a,c){ return a + Number(c.preco_venda)*c.qty }, 0)
  var desc = orig - total
  var now = new Date()
  var dt = now.toLocaleDateString('pt-BR') + ' ' + now.toLocaleTimeString('pt-BR')
  var loja = localStorage.getItem('nome_loja') || 'CONVENFACIL'
  var cnpj = localStorage.getItem('cnpj_loja') || ''
  var rodape = localStorage.getItem('rodape_cupom') || 'Obrigado pela preferencia!'
  var linhas = itens.map(function(c){
    var nome = c.nome.substring(0,24).padEnd(24)
    var qtd = c.qty + 'x'
    var unit = 'R$' + Number(c.preco_final).toFixed(2)
    var subtot = 'R$' + (Number(c.preco_final)*c.qty).toFixed(2)
    return '<div>'+nome+'</div><div style="display:flex;justify-content:space-between"><span>'+qtd+' x '+unit+'</span><span>'+subtot+'</span></div>'
  }).join('')

  var html = '<!DOCTYPE html><html><head><meta charset="UTF-8">'+
    '<style>'+
    '*{margin:0;padding:0;box-sizing:border-box}'+
    'body{font-family:"Courier New",monospace;font-size:11px;width:80mm;background:#fff;color:#000;padding:3mm}'+
    '.c{text-align:center}.r{text-align:right}.b{font-weight:bold}.g{font-size:14px}'+
    '.linha{border-top:1px dashed #000;margin:4px 0}'+
    '@media print{body{width:80mm;-webkit-print-color-adjust:exact;print-color-adjust:exact}}'+
    '</style></head><body>'+
    '<div class="c b" style="font-size:14px">'+loja+'</div>'+
    (cnpj?'<div class="c">CNPJ: '+cnpj+'</div>':'')+
    '<div class="c">'+dt+'</div>'+
    '<div class="linha"></div>'+
    '<div class="b">ITEM&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;TOTAL</div>'+
    '<div class="linha"></div>'+
    linhas+
    '<div class="linha"></div>'+
    '<div style="display:flex;justify-content:space-between"><span>Subtotal:</span><span>R$ '+orig.toFixed(2)+'</span></div>'+
    (desc>0?'<div style="display:flex;justify-content:space-between"><span>Desconto:</span><span>- R$ '+desc.toFixed(2)+'</span></div>':'')+
    '<div class="linha"></div>'+
    '<div style="display:flex;justify-content:space-between" class="b g"><span>TOTAL:</span><span>R$ '+total.toFixed(2)+'</span></div>'+
    '<div class="linha"></div>'+
    '<div class="c" style="margin-top:8px;font-size:10px">'+rodape+'</div>'+
    '<div class="c" style="font-size:10px">ConvênFácil - convenfacil.com.br</div>'+
    '<br><br>'+
    '</body></html>'

  imprimirComPreview(html,'Recibo pronto para impressao')
}

// ============ ATENDIMENTO POR MESAS (modulo, liga/desliga por cliente) ============
var mesasCache=[], mesaAtualId=null, comandaAtualId=null, itensComandaCache=[], comandaTimerInterval=null
// Quando true, os mesmos modais de pagamento do PDV (troco/cartao/PIX/fiado) estao sendo
// reutilizados para fechar a conta de uma mesa em vez de uma venda de balcao (cart).
// Sempre volta pra false ao sair da tela da comanda (ver go()) e ao finalizar o fechamento.
var mesaPagamentoAtivo=false

// Total a cobrar no momento: da comanda da mesa (quando fechando mesa) ou do carrinho (PDV normal).
// Usado por todos os modais de pagamento reaproveitados (troco, PIX, confirmacao) pra nao
// precisar duplicar a logica de cada um so por causa da origem do valor.
function totalParaPagamento(){
  if(mesaPagamentoAtivo){
    return itensComandaCache.filter(function(it){return it.status!=='cancelado'}).reduce(function(a,it){return a+Number(it.preco_unit)*it.qtd},0)
  }
  return cart.reduce(function(a,c){return a+Number(c.preco_final)*c.qty},0)
}

async function renderMesas(){
  var res=await scopeCid(db.from('mesas').select('*')).order('numero')
  mesasCache=res.data||[]
  var grid=document.getElementById('mesas-grid')
  if(!mesasCache.length){grid.innerHTML='<div class="empty">Nenhuma mesa cadastrada ainda. Clique em "+ Nova mesa".</div>';return}
  var cores={livre:'var(--green)',ocupada:'var(--acc)',conta_solicitada:'var(--yellow)'}
  grid.innerHTML=mesasCache.map(function(m){
    var cor=cores[m.status]||'var(--txt3)'
    var tempo=m.aberta_em?tempoDecorrido(m.aberta_em):''
    return '<div onclick="clicarMesa(\''+m.id+'\')" style="cursor:pointer;background:var(--bg1);border:2px solid '+cor+';border-radius:var(--rad2);padding:16px;text-align:center;transition:.15s">'+
      '<div style="font-size:26px;font-weight:800">'+m.numero+'</div>'+
      '<div style="font-size:11px;color:var(--txt3);margin:4px 0;min-height:14px">'+(m.nome||'')+'</div>'+
      '<div style="display:inline-block;padding:3px 10px;border-radius:20px;background:'+cor+';color:#000;font-size:11px;font-weight:700;text-transform:uppercase">'+labelStatusMesa(m.status)+'</div>'+
      (m.status!=='livre'?'<div style="font-size:11px;color:var(--txt3);margin-top:6px">'+(m.garcom_nome||'')+(tempo?' • '+tempo:'')+'</div>':'')+
    '</div>'
  }).join('')
  iniciarRealtimeMesas()
}

function labelStatusMesa(s){
  var map={livre:'Livre',ocupada:'Ocupada',conta_solicitada:'Conta pedida'}
  return map[s]||s
}

function tempoDecorrido(dataIso){
  var ms=Date.now()-new Date(dataIso).getTime()
  var min=Math.floor(ms/60000)
  if(min<60)return min+'min'
  var h=Math.floor(min/60)
  return h+'h'+(min%60)+'min'
}

function abrirNovaMesa(){
  var proxNum=mesasCache.length?Math.max.apply(null,mesasCache.map(function(m){return m.numero}))+1:1
  document.getElementById('nm-numero').value=proxNum
  document.getElementById('nm-capacidade').value=4
  document.getElementById('nm-nome').value=''
  document.getElementById('ov-nova-mesa').classList.add('open')
}

async function confirmarNovaMesa(){
  var numero=parseInt(document.getElementById('nm-numero').value)||0
  if(!numero){toast('Informe o numero da mesa',1);return}
  var capacidade=parseInt(document.getElementById('nm-capacidade').value)||4
  var nome=capitalizarNomeProd(document.getElementById('nm-nome').value.trim())
  await db.from('mesas').insert({numero:numero,capacidade:capacidade,nome:nome||null,status:'livre',cliente_id:meuCid()})
  closeModals()
  toast('Mesa criada!')
  renderMesas()
}

function clicarMesa(id){
  var m=mesasCache.find(function(x){return x.id===id})
  if(!m)return
  if(m.status==='livre'){
    mesaAtualId=id
    document.getElementById('am-titulo').innerHTML='&#x1F37D; Abrir mesa '+m.numero
    document.getElementById('am-cliente').value=''
    document.getElementById('am-pessoas').value=1
    document.getElementById('am-obs').value=''
    document.getElementById('ov-abrir-mesa').classList.add('open')
  }else{
    abrirComanda(id)
  }
}

async function confirmarAbrirMesa(){
  var m=mesasCache.find(function(x){return x.id===mesaAtualId})
  if(!m)return
  var cliente=capitalizarNomeProd(document.getElementById('am-cliente').value.trim())
  var pessoas=parseInt(document.getElementById('am-pessoas').value)||1
  var obs=document.getElementById('am-obs').value.trim()
  var res=await db.from('comandas').insert({mesa_id:m.id,mesa_numero:m.numero,cliente_nome:cliente||null,pessoas:pessoas,garcom_abertura:userLogado.nome,observacoes:obs||null,status:'aberta',cliente_id:meuCid()}).select().single()
  var comanda=res.data
  await db.from('mesas').update({status:'ocupada',garcom_nome:userLogado.nome,comanda_atual_id:comanda.id,aberta_em:new Date().toISOString()}).eq('id',m.id)
  closeModals()
  renderMesas()
  abrirComanda(m.id)
}

async function abrirComanda(mesaId){
  mesaAtualId=mesaId
  var res=await db.from('mesas').select('*').eq('id',mesaId).single()
  var m=res.data
  if(!m||!m.comanda_atual_id){toast('Mesa sem comanda aberta',1);return}
  comandaAtualId=m.comanda_atual_id
  document.getElementById('comanda-titulo').textContent='Mesa '+m.numero+(m.nome?': '+m.nome:'')
  go('comanda')
  await renderComanda()
  if(comandaTimerInterval)clearInterval(comandaTimerInterval)
  atualizarComandaTempo(m.aberta_em)
  comandaTimerInterval=setInterval(function(){atualizarComandaTempo(m.aberta_em)},15000)
}

function atualizarComandaTempo(abertaEm){
  if(!abertaEm)return
  var el=document.getElementById('comanda-tempo')
  if(el)el.textContent='Aberta há '+tempoDecorrido(abertaEm)
}

async function renderComanda(){
  var res=await db.from('itens_comanda').select('*').eq('comanda_id',comandaAtualId).order('lancado_em')
  itensComandaCache=res.data||[]
  var el=document.getElementById('comanda-itens')
  if(!itensComandaCache.length){el.innerHTML='<div class="empty">Nenhum item lançado ainda</div>';document.getElementById('comanda-total').textContent='R$ 0,00';return}
  var statusLabel={em_preparo:'Em preparo',pronto:'Pronto',entregue:'Entregue',cancelado:'Cancelado'}
  var statusCor={em_preparo:'var(--yellow)',pronto:'var(--green)',entregue:'var(--txt3)',cancelado:'var(--red)'}
  el.innerHTML=itensComandaCache.map(function(it){
    var subtotal=Number(it.preco_unit)*it.qtd
    return '<div style="display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid var(--border)'+(it.status==='cancelado'?';opacity:.5':'')+'">'+
      '<div style="flex:1">'+
        '<div style="font-size:13px;font-weight:600">'+it.qtd+'x '+it.produto_nome+'</div>'+
        (it.observacoes?'<div style="font-size:11px;color:var(--txt3)">'+it.observacoes+'</div>':'')+
      '</div>'+
      '<span style="font-size:11px;font-weight:700;color:'+(statusCor[it.status]||'var(--txt3)')+';text-transform:uppercase">'+(statusLabel[it.status]||it.status)+'</span>'+
      '<div style="font-size:13px;font-weight:700;color:var(--acc);min-width:70px;text-align:right">R$ '+subtotal.toFixed(2)+'</div>'+
      (it.status!=='cancelado'&&it.status!=='entregue'?'<button class="btn sm red" onclick="cancelarItemSilencioso(\''+it.id+'\')">Cancelar</button>':'')+
    '</div>'
  }).join('')
  var total=itensComandaCache.filter(function(it){return it.status!=='cancelado'}).reduce(function(a,it){return a+Number(it.preco_unit)*it.qtd},0)
  document.getElementById('comanda-total').textContent='R$ '+total.toFixed(2)
}

// Adicionar item na comanda
var addItemComandaTemp={}
function abrirAddItemComanda(){
  addItemComandaTemp={}
  document.getElementById('aic-busca').value=''
  renderAddItemComandaLista(prods)
  document.getElementById('ov-add-item-comanda').classList.add('open')
}

function filtrarAddItemComanda(){
  var q=document.getElementById('aic-busca').value.toLowerCase()
  renderAddItemComandaLista(prods.filter(function(p){return p.nome.toLowerCase().indexOf(q)>-1}))
}

function renderAddItemComandaLista(lista){
  var el=document.getElementById('aic-lista')
  if(!lista.length){el.innerHTML='<div class="empty">Nenhum produto encontrado</div>';return}
  el.innerHTML=lista.map(function(p){
    var qty=addItemComandaTemp[p.id]||0
    return '<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border)">'+
      '<span style="font-size:18px">'+(p.emoji||'&#x1F4E6;')+'</span>'+
      '<div style="flex:1"><div style="font-size:13px;font-weight:500">'+p.nome+'</div><div style="font-size:11px;color:var(--txt3)">R$ '+Number(p.preco_venda).toFixed(2)+'</div></div>'+
      '<div class="ci-qty">'+
        '<button onclick="mudarQtyAddItem(\''+p.id+'\',-1)">-</button>'+
        '<span id="aic-qty-'+p.id+'">'+qty+'</span>'+
        '<button onclick="mudarQtyAddItem(\''+p.id+'\',1)">+</button>'+
      '</div>'+
    '</div>'
  }).join('')
}

function mudarQtyAddItem(produtoId,delta){
  var atual=addItemComandaTemp[produtoId]||0
  atual=Math.max(0,atual+delta)
  if(atual===0)delete addItemComandaTemp[produtoId]
  else addItemComandaTemp[produtoId]=atual
  var span=document.getElementById('aic-qty-'+produtoId)
  if(span)span.textContent=atual
}

async function confirmarAddItensComanda(){
  var ids=Object.keys(addItemComandaTemp)
  if(!ids.length){toast('Escolha ao menos um item',1);return}
  var linhas=ids.map(function(pid){
    var p=prods.find(function(x){return x.id===pid})
    return{comanda_id:comandaAtualId,produto_id:pid,produto_nome:p.nome,qtd:addItemComandaTemp[pid],preco_unit:Number(p.preco_venda),status:'em_preparo',origem:'garcom',lancado_por:userLogado.nome,impresso:false,cliente_id:meuCid()}
  })
  await db.from('itens_comanda').insert(linhas)
  await db.from('mesas').update({status:'ocupada'}).eq('id',mesaAtualId)
  document.getElementById('ov-add-item-comanda').classList.remove('open')
  toast('Pedido enviado para a cozinha!')
  await renderComanda()
  imprimirItensNovosComanda()
}

async function imprimirItensNovosComanda(){
  var res=await db.from('itens_comanda').select('*').eq('comanda_id',comandaAtualId).eq('impresso',false).neq('status','cancelado')
  var novos=res.data||[]
  if(!novos.length)return
  var m=mesasCache.find(function(x){return x.id===mesaAtualId})
  var now=new Date()
  var linhas=novos.map(function(it){
    return '<div>'+it.qtd+'x '+it.produto_nome+'</div>'+(it.observacoes?'<div style="font-size:10px;color:#555">Obs: '+it.observacoes+'</div>':'')
  }).join('')
  var html='<!DOCTYPE html><html><head><meta charset="UTF-8"><style>'+
    '*{margin:0;padding:0;box-sizing:border-box}body{font-family:"Courier New",monospace;font-size:12px;width:80mm;background:#fff;color:#000;padding:3mm}'+
    '.c{text-align:center}.b{font-weight:bold}.linha{border-top:1px dashed #000;margin:4px 0}'+
    '@media print{body{width:80mm}}</style></head><body>'+
    '<div class="c b" style="font-size:16px">MESA '+(m?m.numero:'')+'</div>'+
    '<div class="c">'+now.toLocaleTimeString('pt-BR')+' - '+now.toLocaleDateString('pt-BR')+'</div>'+
    '<div class="linha"></div>'+linhas+'<div class="linha"></div>'+
    '<div class="c" style="font-size:10px">Garcom: '+userLogado.nome+'</div>'+
    '<script>window.onafterprint=function(){window.close()}<\/script>'+
    '</body></html>'
  imprimirComPreview(html,'Pedido para a cozinha. Mesa '+(m?m.numero:''))
  var idsImpressos=novos.map(function(it){return it.id})
  await db.from('itens_comanda').update({impresso:true}).in('id',idsImpressos)
}

// Cancelamento de item — nunca deleta do banco (soft cancel), mas pro operador se comporta
// como se o item tivesse simplesmente sumido: sem pedir motivo, sem pedir senha, sem aviso.
// A excecao fica registrada por baixo dos panos pro admin ver depois (mesma regra do "Limpar pedido").
async function cancelarItemSilencioso(itemId){
  var item=itensComandaCache.find(function(x){return x.id===itemId})
  if(!item)return
  await db.from('itens_comanda').update({status:'cancelado',cancelado_por:userLogado.nome,cancelado_em:new Date().toISOString()}).eq('id',itemId)
  var m=mesasCache.find(function(x){return x.id===mesaAtualId})
  registrarExcecao('ITEM DE COMANDA CANCELADO',(m?'Mesa '+m.numero+': ':'')+item.qtd+'x '+item.produto_nome,Number(item.preco_unit)*item.qtd)
  renderComanda()
}

// Imprime a comanda como esta agora (conferencia pro cliente ver o que ja consumiu),
// sem fechar nada nem exigir forma de pagamento — pode imprimir varias vezes se quiser.
function imprimirConferenciaComanda(){
  if(!itensComandaCache.length){toast('Nenhum item lançado ainda',1);return}
  var m=mesasCache.find(function(x){return x.id===mesaAtualId})
  var loja=localStorage.getItem('nome_loja')||'CONVENFACIL'
  var now=new Date()
  var ativos=itensComandaCache.filter(function(it){return it.status!=='cancelado'})
  var total=ativos.reduce(function(a,it){return a+Number(it.preco_unit)*it.qtd},0)
  var itensHtml=ativos.map(function(it){
    return '<div style="display:flex;justify-content:space-between"><span>'+it.qtd+'x '+it.produto_nome+'</span><span>R$ '+(Number(it.preco_unit)*it.qtd).toFixed(2)+'</span></div>'
  }).join('')
  var html='<!DOCTYPE html><html><head><meta charset="UTF-8"><style>'+
    '*{margin:0;padding:0;box-sizing:border-box}body{font-family:"Courier New",monospace;font-size:11px;width:80mm;background:#fff;color:#000;padding:3mm}'+
    '.c{text-align:center}.b{font-weight:bold}.g{font-size:14px}.linha{border-top:1px dashed #000;margin:4px 0}'+
    '@media print{body{width:80mm}}</style></head><body>'+
    '<div class="c b g">'+loja+'</div>'+
    '<div class="c b">CONFERENCIA. MESA '+(m?m.numero:'')+'</div>'+
    '<div class="c" style="font-size:10px">Nao e recibo, so conferencia do pedido</div>'+
    '<div class="c">'+now.toLocaleString('pt-BR')+'</div>'+
    '<div class="linha"></div>'+itensHtml+'<div class="linha"></div>'+
    '<div style="display:flex;justify-content:space-between" class="b g"><span>TOTAL:</span><span>R$ '+total.toFixed(2)+'</span></div>'+
    '<div class="linha"></div>'+
    '<div class="c" style="font-size:10px">ConvenFacil - convenfacil.com.br</div>'+
    '<br><br></body></html>'
  imprimirComPreview(html,'Conferencia da mesa '+(m?m.numero:''))
}

// Sinalizar no mapa que o cliente pediu a conta (fica amarelo pros outros garcons verem)
async function pedirContaMesa(){
  await db.from('mesas').update({status:'conta_solicitada'}).eq('id',mesaAtualId)
  toast('Mesa marcada: conta solicitada')
}

// Fechar comanda
function abrirFecharComanda(){
  var total=itensComandaCache.filter(function(it){return it.status!=='cancelado'}).reduce(function(a,it){return a+Number(it.preco_unit)*it.qtd},0)
  if(!total){toast('Nao ha itens para fechar',1);return}
  document.getElementById('fc-total').textContent='R$ '+total.toFixed(2)
  document.getElementById('ov-fechar-comanda').classList.add('open')
}

// Dividir conta: permite fechar a mesa com varias formas de pagamento ao mesmo tempo
// (ex: um paga PIX, outro debito, outro fiado), cada uma com um valor parcial.
// So disponivel no fechamento de mesa (nao no PDV balcao).
var divisaoPagamentos=[]
var divisaoTotal=0
// Quando uma linha da divisao e PIX ou Dinheiro, o valor dela precisa passar pelo modal de
// verdade (QR code / calculadora de troco) antes de entrar na lista — em vez de so digitar
// o numero. divisaoEmAndamento sinaliza pra esses modais compartilhados que, ao confirmar,
// devem voltar pra "Dividir conta" (empurrando a linha) em vez de fechar a comanda inteira.
var divisaoEmAndamento=false
var divisaoLinhaPendente=null

function abrirDividirConta(){
  closeModals()
  mesaPagamentoAtivo=true
  divisaoPagamentos=[]
  divisaoTotal=totalParaPagamento()
  document.getElementById('dp-total').textContent='R$ '+divisaoTotal.toFixed(2)
  document.getElementById('dp-metodo').value='Dinheiro'
  document.getElementById('dp-valor').value=''
  toggleDpFiado()
  renderDivisaoPagamentos()
  document.getElementById('ov-dividir-pagamento').classList.add('open')
}

function toggleDpFiado(){
  var eh=document.getElementById('dp-metodo').value==='Fiado'
  document.getElementById('dp-fiado-campos').style.display=eh?'block':'none'
  if(eh)carregarClientesFiadoDp()
}

async function carregarClientesFiadoDp(){
  var res=await scopeCid(db.from('clientes_fiado').select('*')).order('nome')
  var lista=res.data||[]
  var sel=document.getElementById('dp-fiado-cliente')
  sel.innerHTML='<option value="">-- Selecione --</option>'+lista.map(function(c){
    return'<option value="'+c.id+'">'+c.nome+'</option>'
  }).join('')
  var venc=new Date();venc.setDate(venc.getDate()+7)
  document.getElementById('dp-fiado-data').value=venc.toISOString().slice(0,10)
}

function somaDividido(){
  return divisaoPagamentos.reduce(function(a,p){return a+p.valor},0)
}

function adicionarLinhaDivisao(){
  var metodo=document.getElementById('dp-metodo').value
  var valor=parseFloat(document.getElementById('dp-valor').value)||0
  if(valor<=0){toast('Informe um valor valido',1);return}
  var falta=divisaoTotal-somaDividido()
  if(valor-falta>0.009){toast('Esse valor passa do que falta (R$ '+falta.toFixed(2)+')',1);return}

  if(metodo==='Fiado'){
    var sel=document.getElementById('dp-fiado-cliente')
    var clienteId=sel.value
    var clienteNome=sel.options[sel.selectedIndex]?sel.options[sel.selectedIndex].text:''
    var dataPromessa=document.getElementById('dp-fiado-data').value
    if(!clienteId){toast('Selecione o cliente do fiado',1);return}
    if(!dataPromessa){toast('Informe a data prometida',1);return}
    empurrarLinhaDivisao({metodo:metodo,valor:valor,clienteId:clienteId,clienteNome:clienteNome,dataPromessa:dataPromessa})
    return
  }

  // PIX e Dinheiro chamam o modal de verdade (QR code / calculadora de troco) pro valor dessa
  // fatia especifica, em vez de so aceitar o numero digitado — assim o cliente ve o QR certo
  // pra pagar e o caixa calcula o troco certo, igual seria numa venda normal.
  if(metodo==='PIX'){
    divisaoLinhaPendente={metodo:'PIX',valor:valor}
    divisaoEmAndamento=true
    closeModals()
    abrirPIX(valor)
    return
  }
  if(metodo==='Dinheiro'){
    divisaoLinhaPendente={metodo:'Dinheiro',valor:valor}
    divisaoEmAndamento=true
    abrirTroco(valor)
    return
  }

  // Cartao Debito / Cartao Credito: a maquininha e fisica, nao tem modal de processamento —
  // so confirma o valor direto.
  empurrarLinhaDivisao({metodo:metodo,valor:valor})
}

function empurrarLinhaDivisao(linha){
  divisaoPagamentos.push(linha)
  document.getElementById('dp-valor').value=''
  document.getElementById('ov-dividir-pagamento').classList.add('open')
  renderDivisaoPagamentos()
}

function removerLinhaDivisao(idx){
  divisaoPagamentos.splice(idx,1)
  renderDivisaoPagamentos()
}

function renderDivisaoPagamentos(){
  var ic={Dinheiro:'&#x1F4B5;','Cartao Debito':'&#x1F4B3;','Cartao Credito':'&#x1F4B3;',PIX:'&#x1F4F1;',Fiado:'&#x1F4D3;'}
  var lista=document.getElementById('dp-lista')
  lista.innerHTML=divisaoPagamentos.length?divisaoPagamentos.map(function(p,i){
    return '<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border)">'+
      '<span>'+(ic[p.metodo]||'')+' '+p.metodo+(p.clienteNome?' ('+p.clienteNome+')':'')+'</span>'+
      '<span style="display:flex;align-items:center;gap:8px"><b>R$ '+p.valor.toFixed(2)+'</b>'+
      '<button class="btn sm red" onclick="removerLinhaDivisao('+i+')" style="padding:2px 8px">&#x2715;</button></span>'+
    '</div>'
  }).join(''):'<div class="empty" style="padding:10px 0">Nenhuma forma adicionada ainda</div>'
  var falta=divisaoTotal-somaDividido()
  var faltaEl=document.getElementById('dp-falta')
  if(falta>0.009){
    faltaEl.textContent='Falta dividir: R$ '+falta.toFixed(2)
    faltaEl.style.color='var(--red)'
  } else if(falta<-0.009){
    faltaEl.textContent='Passou do total em R$ '+Math.abs(falta).toFixed(2)
    faltaEl.style.color='var(--red)'
  } else {
    faltaEl.textContent='Valores batem certinho!'
    faltaEl.style.color='var(--green)'
  }
  document.getElementById('dp-confirmar-btn').disabled=Math.abs(falta)>0.009||!divisaoPagamentos.length
}

async function confirmarDivisaoConta(){
  var falta=divisaoTotal-somaDividido()
  if(Math.abs(falta)>0.009){toast('Os valores ainda nao batem com o total',1);return}
  if(!divisaoPagamentos.length){toast('Adicione ao menos uma forma de pagamento',1);return}
  await finalizarFechamentoComandaDividida(divisaoPagamentos.slice())
}

async function finalizarFechamentoComandaDividida(pagamentos){
  var total=totalParaPagamento()
  var resumo=pagamentos.map(function(p){return p.metodo+(p.clienteNome?' ('+p.clienteNome+')':'')+' R$ '+p.valor.toFixed(2)}).join(' + ')
  var descricao='Dividido: '+resumo
  await db.from('comandas').update({status:'fechada',forma_pagamento:descricao,valor_total:total,fechada_em:new Date().toISOString()}).eq('id',comandaAtualId)
  await db.from('mesas').update({status:'livre',garcom_nome:null,comanda_atual_id:null,aberta_em:null}).eq('id',mesaAtualId)
  for(var i=0;i<pagamentos.length;i++){
    var p=pagamentos[i]
    if(p.metodo==='Fiado'){
      await db.from('contas_receber').insert({
        descricao:'Fiado (conta dividida) - '+p.clienteNome,
        cliente_nome:p.clienteNome,
        cliente_fiado_id:p.clienteId,
        venda_id:null,
        valor:p.valor,
        vencimento:p.dataPromessa,
        cliente_id:meuCid()
      })
    }
  }
  closeModals()
  if(comandaTimerInterval){clearInterval(comandaTimerInterval);comandaTimerInterval=null}
  mesaPagamentoAtivo=false
  toast('Conta dividida e fechada! Mesa liberada.')
  imprimirFechamentoComandaDividida(pagamentos,total)
  go('mesas')
}

function imprimirFechamentoComandaDividida(pagamentos,total){
  var m=mesasCache.find(function(x){return x.id===mesaAtualId})
  var loja=localStorage.getItem('nome_loja')||'CONVENFACIL'
  var rodape=localStorage.getItem('rodape_cupom')||'Obrigado pela preferencia!'
  var now=new Date()
  var itensHtml=itensComandaCache.filter(function(it){return it.status!=='cancelado'}).map(function(it){
    return '<div style="display:flex;justify-content:space-between"><span>'+it.qtd+'x '+it.produto_nome+'</span><span>R$ '+(Number(it.preco_unit)*it.qtd).toFixed(2)+'</span></div>'
  }).join('')
  var pagsHtml=pagamentos.map(function(p){
    return '<div style="display:flex;justify-content:space-between"><span>'+p.metodo+(p.clienteNome?' ('+p.clienteNome+')':'')+'</span><span>R$ '+p.valor.toFixed(2)+'</span></div>'
  }).join('')
  var html='<!DOCTYPE html><html><head><meta charset="UTF-8"><style>'+
    '*{margin:0;padding:0;box-sizing:border-box}body{font-family:"Courier New",monospace;font-size:11px;width:80mm;background:#fff;color:#000;padding:3mm}'+
    '.c{text-align:center}.b{font-weight:bold}.g{font-size:14px}.linha{border-top:1px dashed #000;margin:4px 0}'+
    '@media print{body{width:80mm}}</style></head><body>'+
    '<div class="c b" style="font-size:14px">'+loja+'</div>'+
    '<div class="c">'+now.toLocaleDateString('pt-BR')+' '+now.toLocaleTimeString('pt-BR')+'</div>'+
    '<div class="linha"></div><div class="c b">MESA '+(m?m.numero:'')+': FECHAMENTO (CONTA DIVIDIDA)</div><div class="linha"></div>'+
    itensHtml+'<div class="linha"></div>'+
    '<div style="display:flex;justify-content:space-between" class="b g"><span>TOTAL:</span><span>R$ '+total.toFixed(2)+'</span></div>'+
    '<div class="linha"></div><div class="b" style="margin-bottom:2px">Pagamento dividido:</div>'+pagsHtml+
    '<div class="linha"></div><div class="c" style="font-size:10px">'+rodape+'</div>'+
    '</body></html>'
  imprimirComPreview(html,'Recibo da mesa (conta dividida) pronto para impressao')
}

// Fecha a comanda depois que o mesmo fluxo de pagamento do PDV (troco/cartao/PIX/fiado)
// foi concluido — chamado por abrirConfirmar() quando mesaPagamentoAtivo esta ligado.
// Nunca mexe em vendas/itens_venda (isso e so do balcao); fechamento de mesa usa comandas/mesas.
async function finalizarFechamentoComanda(metodo){
  var total=totalParaPagamento()
  await db.from('comandas').update({status:'fechada',forma_pagamento:metodo,valor_total:total,fechada_em:new Date().toISOString()}).eq('id',comandaAtualId)
  await db.from('mesas').update({status:'livre',garcom_nome:null,comanda_atual_id:null,aberta_em:null}).eq('id',mesaAtualId)
  if(metodo.indexOf('Fiado')===0&&payClienteFiado){
    await db.from('contas_receber').insert({
      descricao:'Fiado - '+payClienteFiado.nome,
      cliente_nome:payClienteFiado.nome,
      cliente_fiado_id:payClienteFiado.id,
      venda_id:null,
      valor:total,
      vencimento:payClienteFiado.dataPromessa,
      cliente_id:meuCid()
    })
    payClienteFiado=null
  }
  closeModals()
  if(comandaTimerInterval){clearInterval(comandaTimerInterval);comandaTimerInterval=null}
  mesaPagamentoAtivo=false
  toast('Conta fechada! Mesa liberada.')
  imprimirFechamentoComanda(metodo,total)
  go('mesas')
}

function imprimirFechamentoComanda(metodo,total){
  var m=mesasCache.find(function(x){return x.id===mesaAtualId})
  var loja=localStorage.getItem('nome_loja')||'CONVENFACIL'
  var rodape=localStorage.getItem('rodape_cupom')||'Obrigado pela preferencia!'
  var now=new Date()
  var itensHtml=itensComandaCache.filter(function(it){return it.status!=='cancelado'}).map(function(it){
    return '<div style="display:flex;justify-content:space-between"><span>'+it.qtd+'x '+it.produto_nome+'</span><span>R$ '+(Number(it.preco_unit)*it.qtd).toFixed(2)+'</span></div>'
  }).join('')
  var html='<!DOCTYPE html><html><head><meta charset="UTF-8"><style>'+
    '*{margin:0;padding:0;box-sizing:border-box}body{font-family:"Courier New",monospace;font-size:11px;width:80mm;background:#fff;color:#000;padding:3mm}'+
    '.c{text-align:center}.b{font-weight:bold}.g{font-size:14px}.linha{border-top:1px dashed #000;margin:4px 0}'+
    '@media print{body{width:80mm}}</style></head><body>'+
    '<div class="c b" style="font-size:14px">'+loja+'</div>'+
    '<div class="c">'+now.toLocaleDateString('pt-BR')+' '+now.toLocaleTimeString('pt-BR')+'</div>'+
    '<div class="linha"></div><div class="c b">MESA '+(m?m.numero:'')+': FECHAMENTO</div><div class="linha"></div>'+
    itensHtml+'<div class="linha"></div>'+
    '<div style="display:flex;justify-content:space-between" class="b g"><span>TOTAL:</span><span>R$ '+total.toFixed(2)+'</span></div>'+
    '<div style="display:flex;justify-content:space-between"><span>Pagamento:</span><span>'+metodo+'</span></div>'+
    '<div class="linha"></div><div class="c" style="font-size:10px">'+rodape+'</div>'+
    '<script>window.onafterprint=function(){window.close()}<\/script>'+
    '</body></html>'
  imprimirComPreview(html,'Recibo da mesa pronto para impressao')
}

// KDS — painel da cozinha
async function renderKds(){
  iniciarRealtimeMesas()
  var res=await scopeCid(db.from('itens_comanda').select('*')).in('status',['em_preparo','pronto']).order('lancado_em')
  var itens=res.data||[]
  var grid=document.getElementById('kds-grid')
  if(!itens.length){grid.innerHTML='<div class="empty">Nenhum pedido em producao</div>';return}
  var porComanda={}
  itens.forEach(function(it){
    if(!porComanda[it.comanda_id])porComanda[it.comanda_id]=[]
    porComanda[it.comanda_id].push(it)
  })
  var comandaIds=Object.keys(porComanda)
  var resComandas=await db.from('comandas').select('*').in('id',comandaIds)
  var comandasMap={}
  ;(resComandas.data||[]).forEach(function(c){comandasMap[c.id]=c})
  grid.innerHTML=comandaIds.map(function(cid){
    var itensDaComanda=porComanda[cid]
    var c=comandasMap[cid]
    var mesaNum=c?c.mesa_numero:'?'
    var tempo=c?tempoDecorrido(c.aberta_em):''
    return '<div style="background:var(--bg1);border:1px solid var(--border);border-radius:var(--rad2);padding:14px">'+
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">'+
        '<div style="font-size:17px;font-weight:800">Mesa '+mesaNum+'</div>'+
        '<div style="font-size:11px;color:var(--txt3)">'+tempo+'</div>'+
      '</div>'+
      itensDaComanda.map(function(it){
        return '<div style="padding:8px 0;border-bottom:1px solid var(--border)">'+
          '<div style="font-size:13px;font-weight:600">'+it.qtd+'x '+it.produto_nome+'</div>'+
          (it.observacoes?'<div style="font-size:11px;color:var(--txt3)">'+it.observacoes+'</div>':'')+
          '<div style="display:flex;gap:6px;margin-top:6px">'+
            (it.status==='em_preparo'?'<button class="btn sm grn" onclick="avancarStatusItemKds(\''+it.id+'\',\'pronto\')">&#x2705; Marcar pronto</button>':'')+
            (it.status==='pronto'?'<button class="btn sm" onclick="avancarStatusItemKds(\''+it.id+'\',\'entregue\')">&#x2714; Marcar entregue</button>':'')+
          '</div>'+
        '</div>'
      }).join('')+
    '</div>'
  }).join('')
}

async function avancarStatusItemKds(itemId,novoStatus){
  await db.from('itens_comanda').update({status:novoStatus}).eq('id',itemId)
  renderKds()
  var secComanda=document.getElementById('sec-comanda')
  if(mesaAtualId&&secComanda&&secComanda.classList.contains('on'))renderComanda()
}

// Tempo real (Supabase Realtime) — mantem mapa de mesas e KDS atualizados sozinhos, sem precisar recarregar
var mesasRealtimeIniciado=false
function iniciarRealtimeMesas(){
  if(mesasRealtimeIniciado)return
  mesasRealtimeIniciado=true
  db.channel('mesas-realtime')
    .on('postgres_changes',{event:'*',schema:'public',table:'mesas'},function(){
      var sec=document.getElementById('sec-mesas')
      if(sec&&sec.classList.contains('on'))renderMesas()
    })
    .on('postgres_changes',{event:'*',schema:'public',table:'itens_comanda'},function(){
      var secKds=document.getElementById('sec-kds')
      var secComanda=document.getElementById('sec-comanda')
      if(secKds&&secKds.classList.contains('on'))renderKds()
      if(secComanda&&secComanda.classList.contains('on'))renderComanda()
    })
    .subscribe()
}

// TOAST
var tTimer
function toast(msg,err){
  var t=document.getElementById('tst')
  document.getElementById('tst-m').textContent=msg
  document.getElementById('tic').textContent=err?'x':'ok'
  t.className='toast '+(err?'err':'ok')
  void t.offsetWidth;t.classList.add('show')
  clearTimeout(tTimer);tTimer=setTimeout(function(){t.classList.remove('show')},2800)
}

loadProds();loadPromos()
restaurarSessao()
// Autopreenche so o email na tela de boas-vindas (nunca a senha).
try{
  var emailSalvo=localStorage.getItem('ultimo_login_email')
  if(emailSalvo)document.getElementById('login-email').value=emailSalvo
}catch(e){}
