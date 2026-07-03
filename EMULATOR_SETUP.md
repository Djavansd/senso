# Senso local com Firebase Emulator

Execute `iniciar-senso-local.cmd` na raiz do projeto.

- Aplicativo local: http://127.0.0.1:5500
- Painel dos emuladores: http://127.0.0.1:4000
- Auth: 127.0.0.1:9099
- Firestore: 127.0.0.1:8080
- Functions: 127.0.0.1:5001

O modo local é ativado somente em `localhost`, `127.0.0.1` ou `::1`. O domínio publicado continua conectado ao Firebase de produção.

Ao pressionar `Ctrl+C`, os dados locais são exportados para `.emulator-data` e reaparecem na próxima execução. Essa pasta e o Java portátil estão ignorados pelo Git.
