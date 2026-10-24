# Sidestage

Extensão do GNOME 51 que imita o Stage Manager do macOS: quando você minimiza
uma janela, ela **voa direto para uma miniatura na lateral da tela**. Clique na
miniatura e a janela volta crescendo a partir dela.

- Só mostra janelas **minimizadas**, do workspace atual.
- Cada monitor tem a própria coluna (ou tudo no principal, se preferir).
- Clique: restaura só aquela janela, sem mexer nas outras.
- Clique do meio: fecha a janela.
- As janelas abertas passam **por cima** da coluna, como no Mac.

## Por que é leve

- A animação de minimizar/restaurar é a **nativa do GNOME** (feita pelo
  compositor); o Sidestage só diz para onde a janela deve ir.
- A miniatura é uma **foto tirada uma vez**, no momento de minimizar, e não um
  clone ao vivo. Parado, o Sidestage não consome CPU nem GPU.
- Nada roda em loop: tudo reage a eventos (minimizar, restaurar, trocar de
  workspace, mudar monitor).
- A redução da foto usa mipmaps (filtro trilinear), então a miniatura fica
  nítida, sem serrilhado.

## Instalar

### Como pacote do sistema (recomendado no CachyOS/Arch)

```sh
make package
sudo pacman -U dist/gnome-shell-extension-sidestage-1.0.0-1-any.pkg.tar.zst
```

Depois **saia da sessão e entre de novo** (no Wayland o GNOME só carrega
extensões novas no login) e ative:

```sh
gnome-extensions enable sidestage@mathauscm
```

Para remover: `sudo pacman -R gnome-shell-extension-sidestage`.

### Só para o seu usuário (sem senha)

```sh
make install
```

Saia da sessão, entre de novo e rode `gnome-extensions enable sidestage@mathauscm`.
Para remover: `make uninstall`.

## Configurações

Abra pelo app **Extensões** (botão de engrenagem do Sidestage) ou com
`gnome-extensions prefs sidestage@mathauscm`:

| Opção | Padrão |
|---|---|
| Lado da tela | Esquerda |
| Largura das miniaturas | 180 px |
| Máximo de miniaturas por monitor | 8 |
| Inclinação 3D | 0° (reta) |
| Uma coluna em cada monitor | Ligado |
| Clique do meio fecha a janela | Ligado |

## Desenvolvimento

```
src/                 a extensão (é isso que vai no pacote)
  extension.js       lógica, miniaturas e animação
  prefs.js           janela de configurações (libadwaita)
  stylesheet.css     visual das miniaturas
  schemas/           configurações (GSettings)
packaging/PKGBUILD   pacote do pacman
tests/               teste automático num GNOME Shell sem tela
```

`make test` sobe um `gnome-shell --headless` **isolado** (configurações e
extensões numa pasta temporária, sem tocar na sua sessão), abre três janelas,
minimiza, restaura, troca de workspace e salva prints + `report.json` em
`dist/test/`.

### Detalhes técnicos

- O GNOME anima o minimizar em direção ao *icon geometry* da janela (é assim
  que ela vai para o ícone do dock). O Sidestage grava a posição da miniatura
  nesse campo logo antes da animação, dentro de `Main.wm._shouldAnimateActor`,
  para o Dash to Dock não sobrescrever.
- A coluna fica dentro do grupo do papel de parede
  (`Main.layoutManager._backgroundGroup`), por isso fica abaixo das janelas.
- No mutter 51 o `paint_to_content(clip)` desloca a imagem; por isso a foto é
  da janela inteira e o recorte (sem a margem de sombra) é feito na miniatura.
- A extensão continua ativa na tela de bloqueio (`unlock-dialog`) só para não
  perder as fotos das janelas minimizadas quando você bloqueia o PC.
