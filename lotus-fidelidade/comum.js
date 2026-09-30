(function () {
  var cfg = window.LOTUS_CONFIG || {};
  var configurado = cfg.SUPABASE_URL && cfg.SUPABASE_URL.indexOf("SEU-PROJETO") === -1;

  var L = {};
  L.configurado = configurado;
  L.sb = configurado ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY) : null;

  L.soDigitos = function (v) { return String(v || "").replace(/\D/g, ""); };

  L.mascaraTel = function (v) {
    var d = L.soDigitos(v).slice(0, 11);
    if (d.length <= 2) return d.length ? "(" + d : "";
    if (d.length <= 6) return "(" + d.slice(0, 2) + ") " + d.slice(2);
    if (d.length <= 10) return "(" + d.slice(0, 2) + ") " + d.slice(2, 6) + "-" + d.slice(6);
    return "(" + d.slice(0, 2) + ") " + d.slice(2, 7) + "-" + d.slice(7);
  };

  L.ligarMascara = function (input) {
    input.addEventListener("input", function () { input.value = L.mascaraTel(input.value); });
  };

  L.reais = function (n) {
    return Number(n || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  };
  L.pontos = function (n) { return Number(n || 0).toLocaleString("pt-BR"); };
  L.data = function (d) {
    if (!d) return "";
    return new Date(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" });
  };

  L.esc = function (s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  };

  // quantas petalas (de 10) estao cheias no bloco atual
  L.petalasCheias = function (saldo, porBloco) {
    return Math.floor(((saldo || 0) % porBloco) / (porBloco / 10));
  };

  L.petalasHTML = function (cheias) {
    var h = "";
    for (var i = 0; i < 10; i++) h += '<span class="petala' + (i < cheias ? " cheia" : "") + '" style="animation-delay:' + (i * 70) + 'ms"></span>';
    return h;
  };

  L.erroAmigavel = function (err) {
    var m = (err && err.message) || "";
    if (m.indexOf("Telefone ja cadastrado") > -1) return "Esse celular já está cadastrado. Use a opção Ver meus pontos.";
    if (m.indexOf("Telefone invalido") > -1) return "Confira o celular com DDD, só números.";
    if (m.indexOf("nome completo") > -1) return "Digite seu nome e sobrenome.";
    if (m.indexOf("Saldo insuficiente") > -1) return "O cliente não tem pontos suficientes para esse resgate.";
    if (m.indexOf("Acesso negado") > -1) return "Seu usuário não está liberado como equipe da Lotus.";
    if (m.indexOf("Valor invalido") > -1) return "Digite um valor de compra maior que zero.";
    if (m.indexOf("Invalid login") > -1) return "E-mail ou senha incorretos.";
    if (m.indexOf("Failed to fetch") > -1) return "Sem conexão. Confira a internet e tente de novo.";
    return m || "Não foi possível concluir. Tente de novo.";
  };

  var tId;
  L.toast = function (texto, erro) {
    var t = document.getElementById("toast");
    if (!t) { t = document.createElement("div"); t.id = "toast"; t.setAttribute("role", "status"); document.body.appendChild(t); }
    t.className = "toast" + (erro ? " erro" : "");
    t.textContent = texto;
    t.hidden = false;
    clearTimeout(tId);
    tId = setTimeout(function () { t.hidden = true; }, 3200);
  };

  L.guardar = function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
  L.ler = function (k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } };
  L.apagar = function (k) { try { localStorage.removeItem(k); } catch (e) {} };

  window.Lotus = L;
})();
