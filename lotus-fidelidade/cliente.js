(function () {
  var L = window.Lotus;
  var $ = function (id) { return document.getElementById(id); };
  var CHAVE = "lotus_cliente";

  if (!L.configurado) { $("aviso-config").hidden = false; return; }

  L.ligarMascara($("ver-tel"));
  L.ligarMascara($("cad-tel"));

  function aba(qual) {
    var ver = qual === "ver";
    $("aba-ver").setAttribute("aria-selected", ver);
    $("aba-cad").setAttribute("aria-selected", !ver);
    $("form-ver").hidden = !ver;
    $("form-cad").hidden = ver;
  }
  $("aba-ver").onclick = function () { aba("ver"); };
  $("aba-cad").onclick = function () { aba("cad"); };

  // texto da regra vindo do banco
  L.sb.rpc("regras_programa").then(function (r) {
    var g = r.data;
    if (!g) return;
    $("regra").textContent = "A cada R$ 1 em compras você ganha " + L.pontos(g.pontos_por_real) +
      " pontos. Juntou " + L.pontos(g.pontos_por_bloco) + ", vale " + L.reais(g.reais_por_bloco) + " na próxima compra.";
  });

  function mostrarEntrada() {
    $("tela-pontos").hidden = true;
    $("tela-entrada").hidden = false;
  }

  function nomeTipo(t) {
    return { compra: "Compra", resgate: "Resgate", ajuste: "Ajuste", expiracao: "Pontos vencidos" }[t] || t;
  }

  function mostrarPontos(d) {
    $("tela-entrada").hidden = true;
    $("tela-pontos").hidden = false;

    var porBloco = d.pontos_por_bloco;
    var cheias = L.petalasCheias(d.saldo_pontos, porBloco);
    var p = $("petalas");
    p.innerHTML = L.petalasHTML(cheias);
    p.classList.remove("animar"); void p.offsetWidth; p.classList.add("animar");

    $("oi").textContent = "Oi, " + d.primeiro_nome + "!";
    $("saldo").textContent = L.pontos(d.saldo_pontos);
    var falta = porBloco - (d.saldo_pontos % porBloco);
    $("falta").textContent = "Faltam " + L.pontos(falta) + " pontos para ganhar mais " + L.reais(d.reais_por_bloco) + ".";

    $("premio").hidden = !(d.saldo_resgatavel_reais > 0);
    $("premio-valor").textContent = L.reais(d.saldo_resgatavel_reais);

    $("validade").textContent = d.expira_em
      ? "Seus pontos valem até " + L.data(d.expira_em) + ". Cada compra renova o prazo."
      : "Faça sua primeira compra para começar a juntar pontos.";

    var h = d.historico || [];
    $("extrato").innerHTML = h.length ? h.map(function (m) {
      var cls = m.tipo === "expiracao" ? "venceu" : (m.pontos >= 0 ? "mais" : "menos");
      var desc = nomeTipo(m.tipo) + (m.valor_compra ? " de " + L.reais(m.valor_compra) : "");
      return '<li><div>' + L.esc(desc) + '<div class="data">' + L.data(m.created_at) + '</div></div>' +
        '<span class="' + cls + '">' + (m.pontos > 0 ? "+" : "") + L.pontos(m.pontos) + '</span></li>';
    }).join("") : '<li class="vazio">Nenhuma movimentação ainda.</li>';
  }

  function consultar(nome, tel, msgEl) {
    return L.sb.rpc("consultar_pontos", { p_nome: nome, p_telefone: L.soDigitos(tel) }).then(function (r) {
      if (r.error) throw r.error;
      if (!r.data) {
        if (msgEl) msgEl.textContent = "Não encontramos esse cadastro. Confira o nome completo e o celular do jeito que você cadastrou.";
        L.apagar(CHAVE);
        mostrarEntrada();
        return false;
      }
      L.guardar(CHAVE, { nome: nome, tel: L.soDigitos(tel) });
      mostrarPontos(r.data);
      return true;
    });
  }

  $("form-ver").onsubmit = function (e) {
    e.preventDefault();
    var msg = $("msg-ver"); msg.textContent = "";
    var nome = $("ver-nome").value.trim(), tel = $("ver-tel").value;
    if (!nome || L.soDigitos(tel).length < 10) { msg.textContent = "Preencha nome completo e celular com DDD."; return; }
    var b = e.target.querySelector("button"); b.disabled = true;
    consultar(nome, tel, msg).catch(function (err) { msg.textContent = L.erroAmigavel(err); })
      .then(function () { b.disabled = false; });
  };

  $("form-cad").onsubmit = function (e) {
    e.preventDefault();
    var msg = $("msg-cad"); msg.textContent = "";
    var nome = $("cad-nome").value.trim(), tel = $("cad-tel").value;
    if (nome.split(/\s+/).length < 2) { msg.textContent = "Digite seu nome e sobrenome."; return; }
    if (L.soDigitos(tel).length < 10) { msg.textContent = "Confira o celular com DDD."; return; }
    var b = e.target.querySelector("button"); b.disabled = true;
    L.sb.rpc("cadastrar_cliente", { p_nome: nome, p_telefone: L.soDigitos(tel), p_aceite: $("cad-aceite").checked })
      .then(function (r) {
        if (r.error) throw r.error;
        L.toast("Conta criada! Agora é só informar seu celular no caixa.");
        return consultar(nome, tel, msg);
      })
      .catch(function (err) { msg.textContent = L.erroAmigavel(err); })
      .then(function () { b.disabled = false; });
  };

  $("sair").onclick = function () {
    L.apagar(CHAVE);
    $("ver-nome").value = ""; $("ver-tel").value = "";
    aba("ver");
    mostrarEntrada();
  };

  // se o cliente ja entrou antes neste celular, mostra direto
  var salvo = L.ler(CHAVE);
  if (salvo && salvo.nome && salvo.tel) {
    consultar(salvo.nome, salvo.tel, null).catch(mostrarEntrada);
  } else {
    mostrarEntrada();
  }
})();
