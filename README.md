# dirtyrss

Gracias a [Ivoox](https://ivoox.com) por crear una App tan tan mala que ha conseguido que me entren las ganas
suficientes como para coger el teclado y montar un scrapper de los podcasts para generar un feed rss tradicional.
De esta manera puedo apuntar mi podcatcher favorito a este servidor y subscribirme a ellos de la misma manera
que lo hago con cualquier otra fuente de shows.

*Importante: por mucha tirria que les tenga a los de Ivoox por crear otro [walled garden](https://blog.tail.digital/es/sabes-lo-que-es-walled-garden/)
en esta porquería de web que se nos está quedando, no creo que sea ético implementar este
tipo de proxies como un servicio disponible para todo el mundo. En otras palabras: tengo la conciencia muy
tranquila publicando el código para que puedas crear tu propio servidor personal, pero no me gustaría que lo dejases
abierto a todo el mundo.*

## Instalación

En Ubuntu 20.04:

* Haz un forward del puerto 80 al 3000 (que es donde se ejecutará *DirtyRSS*)

```bash
sudo iptables -t nat -A PREROUTING -p tcp --dport 80 -j REDIRECT --to-port 3000
```

* Prepara el runtime de nodejs

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.1/install.sh | bash
export NVM_DIR="$([ -z "${XDG_CONFIG_HOME-}" ] && printf %s "${HOME}/.nvm" || printf %s "${XDG_CONFIG_HOME}/nvm")"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh" # This loads nvm
nvm install 16.1
```

* Descarga *DirtyRSS* y sus dependencias, después compila

```bash
git clone https://github.com/ciberado/dirtyrss
cd dirtyrss
npm i
PATH=$PATH:$(npm bin)
tsc
```

* Lanza el programa:

```bash
npm run start
```

## Obteniendo feeds

Invoca la dirección del servidor en el que estás ejecutando *DirtyRSS* pasando el nombre del programa que
quieres escuchar como parámetro `podcast`. Por ejemplo:

```bash
http://<IP DE TU SERVIDOR>/?podcast=la voz de horus
```

Obtendrás el feed RSS correspondiente. Ahora solo tienes que compartirlo con tu podcatcher.

**OJO: los enlaces a los audios caducan cada pocas horas**. Así que si no descargas los programas a local,
actualiza tu feed antes de darle al play.

## Colaborando en DirtyRSS

Pull request are welcome! Esta es obviamente una implementación rápida y sucia escrita en un par de días durante
las vacaciones de navidades. A mi me sirve, pero hay optimizaciones obvias que estarían chulas. Por ejemplo:

- [ ] Hacer el código compatible con Lambda
- [ ] Añadir una caché para los shows habituales
- [ ] Revisar por qué algunos programas parece que no se descargan correctamente
- [ ] Documentar mejor el código antes de que crezca
- [ ] Montar una batería de tests
- [ ] Generar podcasts a partir de otras fuentes, como Twitch

Si te animas, coméntamelo y te cuento cómo hackear el código. Ya sabes dónde encontrarme: http://twitter.com/ciberado.
