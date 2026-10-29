// familyspeak.app forms: "Join the test" and "Request your language".
// Sent to the FamilySpeak server (no cookies, no tracking). Messages follow
// the page language (<html lang>); es/ht: ⚠️ pending native-speaker review.
(function () {
  var BASE = 'https://ddqowqcenlcjeyzpfoza.supabase.co/functions/v1/';
  var lang = (document.documentElement.lang || 'en').slice(0, 2);
  if (['en', 'es', 'ht'].indexOf(lang) < 0) lang = 'en';

  var T = {
    en: {
      sending: 'Sending…',
      offline: 'Couldn’t send that. Check your internet and try again.',
      error: 'Something went wrong. Please try again, or email hello@familyspeak.app.',
      tooMany: 'Thanks! We already have it. Please try again later.',
      badEmail: 'Please check the email address.',
      needEmail: 'Please enter your email address.',
      needAges: 'Please pick at least one age.',
      needLanguage: 'Please pick your family language.',
      needIphone: 'Please tell us if you have an iPhone.',
      joined: 'Thank you! We got it. We’ll email you when there’s news for your family.',
      joinedNoIphone: 'Thank you! The test is on iPhone for now. We’ll email you when FamilySpeak is ready for your phone.',
      needRequest: 'Please choose or type a language.',
      badLanguage: 'Please type the language name using letters only.',
      requested: function (l, notify) { return 'Thank you! We counted your request for ' + l + '.' + (notify ? ' We’ll email you when it’s ready.' : ''); },
    },
    es: {
      sending: 'Enviando…',
      offline: 'No se pudo enviar. Revisa tu internet e inténtalo de nuevo.',
      error: 'Algo salió mal. Inténtalo de nuevo o escribe a hello@familyspeak.app.',
      tooMany: '¡Gracias! Ya lo tenemos. Inténtalo más tarde.',
      badEmail: 'Revisa el correo electrónico.',
      needEmail: 'Escribe tu correo electrónico.',
      needAges: 'Elige al menos una edad.',
      needLanguage: 'Elige el idioma de tu familia.',
      needIphone: 'Dinos si tienes iPhone.',
      joined: '¡Gracias! Lo recibimos. Te escribiremos cuando haya novedades para tu familia.',
      joinedNoIphone: '¡Gracias! Por ahora la prueba es en iPhone. Te escribiremos cuando FamilySpeak esté listo para tu teléfono.',
      needRequest: 'Elige o escribe un idioma.',
      badLanguage: 'Escribe el nombre del idioma solo con letras.',
      requested: function (l, notify) { return '¡Gracias! Contamos tu pedido de ' + l + '.' + (notify ? ' Te escribiremos cuando esté listo.' : ''); },
    },
    ht: {
      sending: 'N ap voye l…',
      offline: 'Nou pa t ka voye l. Tcheke entènèt ou epi eseye ankò.',
      error: 'Gen yon bagay ki pa mache. Eseye ankò, oswa ekri hello@familyspeak.app.',
      tooMany: 'Mèsi! Nou gen li deja. Eseye ankò pita.',
      badEmail: 'Tanpri tcheke adrès imèl la.',
      needEmail: 'Tanpri ekri adrès imèl ou.',
      needAges: 'Tanpri chwazi omwen yon laj.',
      needLanguage: 'Tanpri chwazi lang fanmi w.',
      needIphone: 'Tanpri di nou si ou gen yon iPhone.',
      joined: 'Mèsi! Nou resevwa l. N ap ekri w lè gen nouvèl pou fanmi w.',
      joinedNoIphone: 'Mèsi! Pou kounye a, tès la se sou iPhone. N ap ekri w lè FamilySpeak pare pou telefòn ou.',
      needRequest: 'Tanpri chwazi oswa ekri yon lang.',
      badLanguage: 'Tanpri ekri non lang lan ak lèt sèlman.',
      requested: function (l, notify) { return 'Mèsi! Nou konte demann ou pou ' + l + '.' + (notify ? ' N ap ekri w lè li pare.' : ''); },
    },
  }[lang];

  function post(fn, body) {
    return fetch(BASE + fn, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (res) { return res.json().catch(function () { return {}; }).then(function (b) { return { status: res.status, body: b }; }); });
  }
  function sayer(el) {
    return function (text, bad) { el.textContent = text; el.className = 'status' + (bad ? ' bad' : ' good'); };
  }

  // Sign-up (the test, or "not ready yet"). "Request another language" also counts as a language request.
  var join = document.getElementById('join-form');
  if (join) {
    var say = sayer(document.getElementById('jn-status'));
    var button = join.querySelector('button');
    var otherWrap1 = document.getElementById('jn-other-wrap');
    var otherSelect = document.getElementById('jn-other');
    var typedWrap = document.getElementById('jn-typed-wrap');
    var typed = document.getElementById('jn-typed');
    if (otherWrap1) {
      Array.prototype.forEach.call(join.querySelectorAll('input[name="language"]'), function (r) {
        r.addEventListener('change', function () { otherWrap1.hidden = r.value !== 'other' || !r.checked; });
      });
      otherSelect.addEventListener('change', function () {
        typedWrap.hidden = otherSelect.value !== 'other';
        if (!typedWrap.hidden) typed.focus();
      });
    }
    join.addEventListener('submit', function (e) {
      e.preventDefault();
      var email = join.email.value.trim();
      var ages = Array.prototype.slice.call(join.querySelectorAll('input[name="age"]:checked')).map(function (i) { return Number(i.value); });
      var language = (join.querySelector('input[name="language"]:checked') || {}).value;
      var iphone = (join.querySelector('input[name="iphone"]:checked') || {}).value;
      var requested = language === 'other' && otherSelect ? (otherSelect.value === 'other' ? typed.value.trim() : otherSelect.value) : '';
      if (!email) return say(T.needEmail, true);
      if (!join.email.checkValidity()) return say(T.badEmail, true);
      if (!language) return say(T.needLanguage, true);
      if (language === 'other' && otherSelect && !requested) return say(T.needRequest, true);
      if (!ages.length) return say(T.needAges, true);
      if (!iphone) return say(T.needIphone, true);
      button.disabled = true;
      say(T.sending);
      if (requested) {
        post('language-request', { source: 'web', language: requested, email: email, askedIn: lang, website: join.website.value }).catch(function () {});
      }
      post('test-signup', { email: email, kidAges: ages, familyLanguage: language, hasIphone: iphone === 'yes', siteLanguage: lang, website: join.website.value })
        .then(function (r) {
          if (r.status === 200) {
            join.reset();
            if (otherWrap1) { otherWrap1.hidden = true; typedWrap.hidden = true; }
            say(iphone === 'yes' ? T.joined : T.joinedNoIphone);
          } else if (r.body && r.body.error === 'bad_email') say(T.badEmail, true);
          else if (r.status === 429) say(T.tooMany, true);
          else say(T.error, true);
        })
        .catch(function () { say(T.offline, true); })
        .then(function () { button.disabled = false; });
    });
  }

  // Request your language
  var form = document.getElementById('request-form');
  if (form) {
    var select = document.getElementById('rq-language');
    var otherWrap = document.getElementById('rq-other-wrap');
    var other = document.getElementById('rq-other');
    var email2 = document.getElementById('rq-email');
    var say2 = sayer(document.getElementById('rq-status'));
    var button2 = form.querySelector('button');
    select.addEventListener('change', function () {
      otherWrap.hidden = select.value !== 'other';
      if (!otherWrap.hidden) other.focus();
    });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var language = select.value === 'other' ? other.value.trim() : select.value;
      if (!language) return say2(T.needRequest, true);
      if (email2.value && !email2.checkValidity()) return say2(T.badEmail, true);
      button2.disabled = true;
      say2(T.sending);
      post('language-request', { source: 'web', language: language, email: email2.value.trim() || null, askedIn: lang, website: form.website.value })
        .then(function (r) {
          if (r.status === 200) {
            var notify = !!email2.value.trim();
            form.reset();
            otherWrap.hidden = true;
            say2(T.requested(language, notify));
          } else if (r.body && r.body.error === 'bad_email') say2(T.badEmail, true);
          else if (r.body && r.body.error === 'bad_language') say2(T.badLanguage, true);
          else if (r.status === 429) say2(T.tooMany, true);
          else say2(T.error, true);
        })
        .catch(function () { say2(T.offline, true); })
        .then(function () { button2.disabled = false; });
    });
  }
})();
