(function () {
  var L = window.Lotus;
  var $ = function (id) { return document.getElementById(id); };
  var sb = L.sb;

  if (!L.configurado) { $("aviso-config").hidden = false; return; }

  var CFG = { pontos_por_real: 10, pontos_por_resgate: 1000, reais_por_resgate: 5, validade_meses: 6 };
  var atual = null;          // cliente selecionado (linha do painel_clientes)
  var todos = [];            // lista completa da aba Clientes
  var ultimaMsgWhats = null;
  var SITE = location.origin + "/";

  /* ---------------- login ---------------- */
  function telaLogin() { $("app").hidden = true; $("tela-login").hidden = false; }

  function entrarNoApp(session) {
    return sb.rpc("is_admin").then(function (r) {
      if (r.error || !r.data) {
        $("msg-login").textContent = "Seu usuário não está liberado como equipe da Lotus.";
        sb.auth.signOut();
        telaLogin();
        return;
      }
      $("tela-login").hidden = true;
      $("app").hidden = false;
      $("quem").textContent = session.user.email;
      return sb.from("config").select("*").single().then(function (c) {
        if (c.data) CFG = c.data;
        $("qr-regra").textContent = "A cada R$ 1 você ganha " + L.pontos(CFG.pontos_por_real) + " pontos. Juntou " +
          L.pontos(CFG.pontos_por_resgate) + ", vale " + L.reais(CFG.reais_por_resgate) + " na próxima compra.";
      });
    });
  }

  $("form-login").onsubmit = function (e) {
    e.preventDefault();
    var msg = $("msg-login"); msg.textContent = "";
    var b = e.target.querySelector("button"); b.disabled = true;
    sb.auth.signInWithPassword({ email: $("login-email").value.trim(), password: $("login-senha").value })
      .then(function (r) {
        if (r.error) throw r.error;
        return entrarNoApp(r.data.session);
      })
      .catch(function (err) { msg.textContent = L.erroAmigavel(err); })
      .then(function () { b.disabled = false; });
  };

  $("sair").onclick = function () { sb.auth.signOut().then(function () { location.reload(); }); };

  sb.auth.getSession().then(function (r) {
    if (r.data && r.data.session) entrarNoApp(r.data.session); else telaLogin();
  });

  /* ---------------- abas ---------------- */
  var qrFeito = false;
  function abrirAba(nome) {
    document.querySelectorAll(".abas button").forEach(function (b) {
      b.setAttribute("aria-selected", b.dataset.aba === nome);
    });
    ["balcao", "clientes", "qr"].forEach(function (n) { $("aba-" + n).hidden = n !== nome; });
    if (nome === "clientes") carregarTodos();
    if (nome === "qr" && !qrFeito) {
      $("qr-url").textContent = SITE;
      if (window.QRCode) {
        new QRCode($("qr"), { text: SITE, width: 240, height: 240, colorDark: "#061326", colorLight: "#ffffff" });
      } else {
        $("qr").textContent = "Não foi possível gerar o QR. Use o endereço abaixo num gerador de QR code.";
      }
      qrFeito = true;
    }
  }
  document.querySelectorAll(".abas button").forEach(function (b) {
    b.onclick = function () { abrirAba(b.dataset.aba); };
  });

  /* ---------------- busca ---------------- */
  var tBusca;
  $("busca").addEventListener("input", function () {
    clearTimeout(tBusca);
    tBusca = setTimeout(buscar, 280);
  });

  function buscar() {
    var q = $("busca").value.trim();
    var dig = L.soDigitos(q);
    var lista = $("resultados");
    if (q.length < 3) { lista.innerHTML = ""; $("busca-dica").hidden = false; return; }
    $("busca-dica").hidden = true;

    var consulta = sb.from("painel_clientes").select("*").order("nome").limit(8);
    consulta = dig.length >= 3 && dig.length === q.replace(/[\s()\-]/g, "").length
      ? consulta.ilike("telefone", "%" + dig + "%")
      : consulta.ilike("nome", "%" + q.replace(/[%_]/g, "") + "%");

    consulta.then(function (r) {
      if (r.error) { L.toast(L.erroAmigavel(r.error), true); return; }
      if (!r.data.length) { lista.innerHTML = '<li class="dica" style="padding:12px 4px">Nenhum cliente encontrado.</li>'; return; }
      lista.innerHTML = r.data.map(function (c) {
        return '<li><button type="button" data-id="' + c.id + '"><span>' + L.esc(c.nome) +
          '<small>' + L.mascaraTel(c.telefone) + '</small></span><span class="dica">' + L.pontos(c.saldo) + ' pts</span></button></li>';
      }).join("");
      lista.querySelectorAll("button").forEach(function (b) {
        b.onclick = function () { selecionar(b.dataset.id); };
      });
    });
  }

  /* ---------------- cliente selecionado ---------------- */
  function selecionar(id) {
    return Promise.all([
      sb.from("painel_clientes").select("*").eq("id", id).single(),
      sb.from("movimentacoes").select("tipo, valor_compra, pontos, created_at").eq("cliente_id", id)
        .order("created_at", { ascending: false }).limit(15)
    ]).then(function (res) {
      if (res[0].error) { L.toast(L.erroAmigavel(res[0].error), true); return; }
      atual = res[0].data;
      desenharCliente(res[1].data || []);
      document.querySelectorAll(".resultados button").forEach(function (b) {
        b.classList.toggle("ativo", b.dataset.id === id);
      });
    });
  }

  function reaisResgataveis(saldo) {
    return Math.floor(saldo / CFG.pontos_por_resgate) * CFG.reais_por_resgate;
  }

  function nomeTipo(t) {
    return { compra: "Compra", resgate: "Resgate", ajuste: "Ajuste", expiracao: "Pontos vencidos" }[t] || t;
  }

  function desenharCliente(movs) {
    var c = atual;
    $("sem-cliente").hidden = true;
    $("cliente").hidden = false;
    $("cli-nome").textContent = c.nome;
    $("cli-tel").textContent = L.mascaraTel(c.telefone) + (c.aceite_marketing ? "" : "  |  não aceitou promoções");
    $("cli-saldo").textContent = L.pontos(c.saldo);
    $("cli-reais").textContent = L.reais(reaisResgataveis(c.saldo));
    $("cli-validade").textContent = c.saldo > 0 && c.expira_em ? L.data(c.expira_em) : "-";

    var p = $("cli-petalas");
    p.innerHTML = L.petalasHTML(L.petalasCheias(c.saldo, CFG.pontos_por_resgate));
    p.classList.remove("animar"); void p.offsetWidth; p.classList.add("animar");

    // resgate
    var max = Math.floor(c.saldo / CFG.pontos_por_resgate);
    var sel = $("resgate-blocos");
    sel.innerHTML = "";
    for (var i = 1; i <= max; i++) {
      var o = document.createElement("option");
      o.value = i;
      o.textContent = L.reais(i * CFG.reais_por_resgate) + " (" + L.pontos(i * CFG.pontos_por_resgate) + " pontos)";
      sel.appendChild(o);
    }
    sel.disabled = max === 0;
    $("btn-resgate").disabled = max === 0;
    $("resgate-dica").textContent = max === 0
      ? "Faltam " + L.pontos(CFG.pontos_por_resgate - (c.saldo % CFG.pontos_por_resgate)) + " pontos para o primeiro resgate."
      : "";

    $("cli-extrato").innerHTML = movs.length ? movs.map(function (m) {
      var cls = m.tipo === "expiracao" ? "venceu" : (m.pontos >= 0 ? "mais" : "menos");
      var desc = nomeTipo(m.tipo) + (m.valor_compra ? " de " + L.reais(m.valor_compra) : "");
      return '<li><div>' + L.esc(desc) + '<div class="data">' + new Date(m.created_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) +
        '</div></div><span class="' + cls + '">' + (m.pontos > 0 ? "+" : "") + L.pontos(m.pontos) + '</span></li>';
    }).join("") : '<li class="dica">Nenhuma movimentação ainda.</li>';
  }

  /* ---------------- whatsapp ---------------- */
  function mensagem(c, ganhouReais, pontosGanhos) {
    var cheias = L.petalasCheias(c.saldo, CFG.pontos_por_resgate);
    var barra = "✅".repeat(cheias) + "⭕".repeat(10 - cheias);
    var falta = CFG.pontos_por_resgate - (c.saldo % CFG.pontos_por_resgate);
    var linhas = [];
    linhas.push(pontosGanhos ? "Mais " + L.pontos(pontosGanhos) + " pontos na sua conta 😎" : "Olá, " + c.nome.split(" ")[0] + "! 😊");
    linhas.push("Esse é o *seu progresso* no Lotus Fidelidade ⬇️", "", barra + " 🎯", "");
    if (ganhouReais) linhas.push("Parabéns! Você *GANHOU " + L.reais(ganhouReais) + "* para usar na sua próxima compra. 🥳", "");
    linhas.push("Seu saldo: *" + L.pontos(c.saldo) + " pontos*");
    var r = reaisResgataveis(c.saldo);
    if (r > 0) linhas.push("Disponível para usar: *" + L.reais(r) + "*");
    linhas.push("Faltam " + L.pontos(falta) + " pontos para ganhar mais " + L.reais(CFG.reais_por_resgate) + ".");
    if (c.expira_em && c.saldo > 0) linhas.push("_(válido até " + L.data(c.expira_em) + ")_");
    linhas.push("", "Acompanhe seus pontos: " + SITE);
    return linhas.join("\n");
  }

  function abrirWhats(texto) {
    var tel = L.soDigitos(atual.telefone);
    window.open("https://wa.me/55" + tel + "?text=" + encodeURIComponent(texto), "_blank", "noopener");
  }

  $("btn-whats").onclick = function () { if (atual) abrirWhats(mensagem(atual, 0, 0)); };
  $("btn-whats-compra").onclick = function () { if (atual && ultimaMsgWhats) abrirWhats(ultimaMsgWhats); };

  /* ---------------- compra ---------------- */
  function lerValor() {
    var v = $("compra-valor").value.trim().replace(/\./g, "").replace(",", ".");
    var n = parseFloat(v);
    return isNaN(n) ? 0 : Math.round(n * 100) / 100;
  }

  $("compra-valor").addEventListener("input", function () {
    var v = lerValor();
    $("compra-preview").textContent = v > 0 ? "Vai gerar " + L.pontos(Math.floor(v * CFG.pontos_por_real)) + " pontos" : "";
  });

  $("form-compra").onsubmit = function (e) {
    e.preventDefault();
    if (!atual) return;
    var valor = lerValor();
    if (valor <= 0) { L.toast("Digite o valor da compra.", true); return; }
    var b = e.target.querySelector("button"); b.disabled = true;
    var blocosAntes = Math.floor(atual.saldo / CFG.pontos_por_resgate);
    var id = atual.id;

    sb.rpc("registrar_compra", { p_cliente_id: id, p_valor: valor })
      .then(function (r) {
        if (r.error) throw r.error;
        var ganhos = r.data;
        $("compra-valor").value = ""; $("compra-preview").textContent = "";
        L.toast("Compra registrada: +" + L.pontos(ganhos) + " pontos");
        return selecionar(id).then(function () {
          var blocosDepois = Math.floor(atual.saldo / CFG.pontos_por_resgate);
          var ganhou = Math.max(0, blocosDepois - blocosAntes) * CFG.reais_por_resgate;
          ultimaMsgWhats = mensagem(atual, ganhou, ganhos);
          $("depois").hidden = false;
        });
      })
      .catch(function (err) { L.toast(L.erroAmigavel(err), true); })
      .then(function () { b.disabled = false; });
  };

  /* ---------------- resgate ---------------- */
  $("form-resgate").onsubmit = function (e) {
    e.preventDefault();
    if (!atual) return;
    var blocos = parseInt($("resgate-blocos").value, 10);
    if (!blocos) return;
    var reais = L.reais(blocos * CFG.reais_por_resgate);
    if (!confirm("Confirmar resgate de " + reais + " para " + atual.nome + "?")) return;
    var b = $("btn-resgate"); b.disabled = true;
    var id = atual.id;
    sb.rpc("registrar_resgate", { p_cliente_id: id, p_blocos: blocos })
      .then(function (r) {
        if (r.error) throw r.error;
        L.toast("Resgate registrado: " + reais + " de desconto");
        $("depois").hidden = true;
        return selecionar(id);
      })
      .catch(function (err) { L.toast(L.erroAmigavel(err), true); b.disabled = false; });
  };

  /* ---------------- cliente novo ---------------- */
  L.ligarMascara($("novo-tel"));
  $("btn-novo").onclick = function () { $("form-novo").hidden = !$("form-novo").hidden; };

  $("form-novo").onsubmit = function (e) {
    e.preventDefault();
    var msg = $("msg-novo"); msg.textContent = "";
    var nome = $("novo-nome").value.trim(), tel = L.soDigitos($("novo-tel").value);
    if (nome.split(/\s+/).length < 2) { msg.textContent = "Digite nome e sobrenome."; return; }
    if (tel.length < 10) { msg.textContent = "Confira o celular com DDD."; return; }
    var b = e.target.querySelector("button"); b.disabled = true;
    sb.rpc("cadastrar_cliente", { p_nome: nome, p_telefone: tel, p_aceite: $("novo-aceite").checked })
      .then(function (r) {
        if (r.error) throw r.error;
        L.toast("Cliente cadastrado");
        $("form-novo").reset(); $("form-novo").hidden = true;
        todos = [];
        return selecionar(r.data);
      })
      .catch(function (err) { msg.textContent = L.erroAmigavel(err); })
      .then(function () { b.disabled = false; });
  };

  /* ---------------- aba clientes ---------------- */
  function carregarTodos() {
    $("contagem").textContent = "Carregando...";
    var pagina = 1000, acumulado = [];
    function lote(de) {
      return sb.from("painel_clientes").select("*").order("nome").range(de, de + pagina - 1).then(function (r) {
        if (r.error) throw r.error;
        acumulado = acumulado.concat(r.data);
        if (r.data.length === pagina) return lote(de + pagina);
        return acumulado;
      });
    }
    lote(0).then(function (lista) { todos = lista; filtrar(); })
      .catch(function (err) { $("contagem").textContent = L.erroAmigavel(err); });
  }

  function diasDesde(d) { return d ? (Date.now() - new Date(d).getTime()) / 864e5 : Infinity; }
  function diasAte(d) { return d ? (new Date(d).getTime() - Date.now()) / 864e5 : -1; }

  function filtrados() {
    var q = $("f-texto").value.trim().toLowerCase(), dig = L.soDigitos(q), tipo = $("f-tipo").value;
    return todos.filter(function (c) {
      if (q && c.nome.toLowerCase().indexOf(q) === -1 && !(dig && c.telefone.indexOf(dig) > -1)) return false;
      if (tipo === "marketing") return c.aceite_marketing;
      if (tipo === "resgatar") return reaisResgataveis(c.saldo) > 0;
      if (tipo === "vencendo") { var a = diasAte(c.expira_em); return c.saldo > 0 && a >= 0 && a <= 30; }
      if (tipo === "sumidos") return c.qtd_compras > 0 && diasDesde(c.ultima_compra) >= 60;
      if (tipo === "nunca") return Number(c.qtd_compras) === 0;
      return true;
    });
  }

  function filtrar() {
    var l = filtrados();
    $("contagem").textContent = l.length + (l.length === 1 ? " cliente" : " clientes");
    $("lista").innerHTML = l.map(function (c) {
      return '<tr data-id="' + c.id + '"><td>' + L.esc(c.nome) + '</td><td>' + L.mascaraTel(c.telefone) +
        '</td><td class="num">' + L.pontos(c.saldo) + '</td><td class="num">' + L.reais(reaisResgataveis(c.saldo)) +
        '</td><td class="num">' + c.qtd_compras + '</td><td class="num">' + L.reais(c.total_gasto) +
        '</td><td>' + (L.data(c.ultima_compra) || "-") + '</td><td>' + (c.aceite_marketing ? "Sim" : "Não") + '</td></tr>';
    }).join("");
    $("lista").querySelectorAll("tr").forEach(function (tr) {
      tr.onclick = function () { abrirAba("balcao"); selecionar(tr.dataset.id); };
    });
  }
  $("f-texto").addEventListener("input", filtrar);
  $("f-tipo").addEventListener("change", filtrar);

  $("exportar").onclick = function () {
    var l = filtrados();
    var cab = ["Nome", "Celular", "Pontos", "Para resgatar (R$)", "Compras", "Total gasto (R$)", "Última compra", "Pontos válidos até", "Aceita promoções", "Cadastrado em"];
    var br = function (n) { return Number(n || 0).toFixed(2).replace(".", ","); };
    var linhas = l.map(function (c) {
      return [c.nome, "55" + c.telefone, c.saldo, br(reaisResgataveis(c.saldo)), c.qtd_compras, br(c.total_gasto),
        L.data(c.ultima_compra), c.saldo > 0 ? L.data(c.expira_em) : "", c.aceite_marketing ? "Sim" : "Não", L.data(c.created_at)];
    });
    var csv = [cab].concat(linhas).map(function (r) {
      return r.map(function (v) { return '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"'; }).join(";");
    }).join("\r\n");
    var blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "clientes-lotus-" + new Date().toISOString().slice(0, 10) + ".csv";
    document.body.appendChild(a); a.click(); a.remove();
  };
})();
