# Lotus Fidelidade

Site do cliente (cadastro e consulta de pontos) em `/` e painel do balcão em `/admin`.

Regra atual: R$ 1 = 10 pontos, 1.000 pontos = R$ 5, resgate em blocos de 1.000, pontos vencem 6 meses após a última compra (cada compra renova o prazo). Tudo isso muda na tabela `config`, sem mexer no código.

## 1. Supabase
1. Crie um projeto novo.
2. Em SQL Editor, cole e rode o arquivo `supabase.sql` inteiro.
3. Em Authentication, desative o cadastro público de usuários (sign ups).
4. Em Authentication > Users, crie o usuário do balcão (e-mail e senha).
5. Copie o UID desse usuário e rode no SQL Editor:
   `insert into public.admins (user_id, nome) values ('UID_AQUI', 'Balcão Lotus');`
6. Em Project Settings > API, copie a Project URL e a chave anon/public.

## 2. Configurar
Abra `config.js` e cole a URL e a chave anon.
A chave anon pode ficar no front. A service_role NUNCA vai aqui.

## 3. Vercel
Suba a pasta num repositório do GitHub e importe na Vercel como projeto estático (sem framework, sem build).
Depois aponte o domínio ou subdomínio que for usar.

## 4. Balcão
Entre em `/admin`, aba "QR do balcão", e imprima o QR. Ele aponta para o endereço onde o site estiver publicado, então imprima só depois de configurar o domínio final.

## Arquivos
- `index.html` + `cliente.js`: tela do cliente
- `admin.html` + `admin.js`: balcão, lista de clientes, exportação e QR
- `comum.js`: funções compartilhadas
- `styles.css`: cores e estilos da marca
- `supabase.sql`: banco, regras de acesso e funções
