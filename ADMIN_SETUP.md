# Ativação segura da gestão interna

O código do painel não contém e-mail, UID, senha ou lista de administradores. A primeira conta administrativa precisa ser ativada uma única vez em um ambiente privilegiado (Console Firebase ou Admin SDK).

## 1. Ativar somente a conta proprietária

No documento `users/{seuUid}`, defina:

```json
{
  "admin": true,
  "autorizado": true,
  "status": "ativo"
}
```

Não defina `admin: true` em nenhuma outra conta. As regras do aplicativo tornam esse campo imutável pelo cliente, inclusive para administradores.

## 2. Publicar as regras antes da interface

Autentique a Firebase CLI e valide/publice as regras:

```powershell
firebase login
firebase deploy --only firestore:rules
```

Depois publique os arquivos da aplicação pelo fluxo normal do projeto. Enquanto as novas regras não forem publicadas, a interface administrativa não deve ser considerada pronta para produção.

## 3. MFA

Com o Identity Platform e o MFA por SMS habilitados, abra a gestão interna. O Senso direcionará a conta administrativa para `seguranca-conta.html`, onde será necessário:

1. verificar o e-mail;
2. cadastrar o telefone;
3. confirmar o código;
4. sair e entrar novamente usando senha e SMS.

As regras exigem `email_verified` e a claim `firebase.sign_in_second_factor == "phone"`. Portanto, alterar o JavaScript ou possuir somente `admin: true` não libera operações administrativas.

## Garantias implementadas

- usuários comuns não podem listar contas;
- `admin` não pode ser alterado pelo frontend;
- aprovação, bloqueio e plano exigem administrador ativo;
- cada alteração exige um registro atômico em `adminAudit`;
- logs não podem ser editados ou excluídos pelo frontend;
- o administrador não pode bloquear nem alterar a própria conta pelo painel;
- usuários aguardando ou bloqueados não acessam os dados operacionais.
