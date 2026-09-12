'use strict';

const json = (schema, example) => ({
  content: { 'application/json': example === undefined ? { schema } : { schema, example } },
});

const ref = (name) => ({ $ref: `#/components/schemas/${name}` });

const spec = {
  openapi: '3.0.3',
  info: {
    title: 'Grove Tech Commerce API',
    version: '1.4.2',
    description: [
      'Interne REST API pre objednavkovy a dokumentovy modul Grove Tech.',
      '',
      'Rozhranie pouzivaju zakaznicke portaly, fakturacny modul a integracne',
      'nastroje. Autentifikacia prebieha cez JWT vydany na `/auth/login`,',
      'pripadne cez servisny kluc v hlavicke `X-API-Key`.',
      '',
      'Referencne prostredie obsahuje demo data dvoch zakaznikov (`acme` a',
      '`globex`) a servisneho operatora. Data sa daju kedykolvek vratit do',
      'vychodzieho stavu cez `POST /maintenance/reseed`.',
    ].join('\n'),
    contact: { name: 'Grove Tech Platform', email: 'platform@grove-tech.test' },
  },
  servers: [
    { url: '/api/v1', description: 'Aktualne nasadenie' },
    { url: 'https://grove-tech.grovecloud.cz/api/v1', description: 'Referencne prostredie' },
  ],
  tags: [
    { name: 'Authentication', description: 'Prihlasenie, registracia a obnova hesla' },
    { name: 'Profile', description: 'Udaje prihlaseneho pouzivatela' },
    { name: 'Catalog', description: 'Verejny katalog produktov' },
    { name: 'Orders', description: 'Objednavky zakaznika' },
    { name: 'Documents', description: 'Zmluvy a prilohy' },
    { name: 'Invoices', description: 'Fakturacne doklady' },
    { name: 'Notes', description: 'Pouzivatelske poznamky' },
    { name: 'Administration', description: 'Sprava pouzivatelov a konfiguracie' },
    { name: 'Integrations', description: 'Nastroje pre integracie a importy' },
    { name: 'Files', description: 'Nahravanie a vydavanie suborov' },
    { name: 'Diagnostics', description: 'Stav sluzby a kontrola konektivity' },
  ],
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      apiKeyAuth: { type: 'apiKey', in: 'header', name: 'X-API-Key' },
      cookieAuth: { type: 'apiKey', in: 'cookie', name: 'session' },
    },
    schemas: {
      Error: {
        type: 'object',
        properties: {
          error: { type: 'string', example: 'not_found' },
          message: { type: 'string', example: 'Zaznam neexistuje.' },
        },
      },
      LoginRequest: {
        type: 'object',
        required: ['email', 'password'],
        properties: {
          email: { type: 'string', format: 'email', example: 'alice@acme.test' },
          password: { type: 'string', format: 'password', example: 'Alpha#2024' },
        },
      },
      LoginResponse: {
        type: 'object',
        properties: {
          access_token: { type: 'string' },
          token_type: { type: 'string', example: 'Bearer' },
          expires_in: { type: 'integer', example: 86400 },
          user: ref('UserSummary'),
        },
      },
      UserSummary: {
        type: 'object',
        properties: {
          id: { type: 'integer', example: 1 },
          email: { type: 'string', example: 'alice@acme.test' },
          full_name: { type: 'string', example: 'Alica Novakova' },
          role: { type: 'string', enum: ['user', 'admin'], example: 'user' },
          tenant: { type: 'string', example: 'acme' },
        },
      },
      Profile: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          email: { type: 'string' },
          full_name: { type: 'string' },
          phone: { type: 'string' },
          role: { type: 'string' },
          tenant: { type: 'string' },
          api_key: { type: 'string' },
          created_at: { type: 'string', format: 'date-time' },
        },
      },
      ProfileUpdate: {
        type: 'object',
        properties: {
          email: { type: 'string' },
          full_name: { type: 'string' },
          phone: { type: 'string' },
          role: { type: 'string' },
          tenant: { type: 'string' },
          api_key: { type: 'string' },
        },
      },
      Product: {
        type: 'object',
        properties: {
          id: { type: 'integer', example: 3 },
          sku: { type: 'string', example: 'GT-2001' },
          name: { type: 'string', example: 'Grove Gateway 4G' },
          description: { type: 'string' },
          price: { type: 'number', format: 'float', example: 749 },
          stock: { type: 'integer', example: 8 },
          category: { type: 'string', example: 'brany' },
        },
      },
      Order: {
        type: 'object',
        properties: {
          id: { type: 'integer', example: 1001 },
          user_id: { type: 'integer', example: 1 },
          tenant: { type: 'string', example: 'acme' },
          item: { type: 'string' },
          quantity: { type: 'integer' },
          amount: { type: 'number', format: 'float' },
          currency: { type: 'string', example: 'EUR' },
          status: { type: 'string', enum: ['pending', 'processing', 'paid', 'shipped'] },
          internal_note: { type: 'string' },
          created_at: { type: 'string', format: 'date-time' },
        },
      },
      OrderCreate: {
        type: 'object',
        required: ['item', 'quantity', 'amount'],
        properties: {
          item: { type: 'string', example: 'Grove Sensor Pro' },
          quantity: { type: 'integer', example: 5 },
          amount: { type: 'number', example: 1945 },
          currency: { type: 'string', example: 'EUR' },
          status: { type: 'string', example: 'pending' },
          tenant: { type: 'string', example: 'acme' },
          user_id: { type: 'integer', description: 'Volitelne, pre objednavky zalozene servisnym uctom.' },
          internal_note: { type: 'string' },
        },
      },
      Document: {
        type: 'object',
        properties: {
          id: { type: 'integer', example: 5001 },
          user_id: { type: 'integer' },
          tenant: { type: 'string' },
          title: { type: 'string' },
          filename: { type: 'string' },
          classification: { type: 'string', enum: ['internal', 'confidential', 'restricted'] },
          body: { type: 'string' },
          created_at: { type: 'string', format: 'date-time' },
        },
      },
      Invoice: {
        type: 'object',
        properties: {
          id: { type: 'integer', example: 7001 },
          user_id: { type: 'integer' },
          tenant: { type: 'string' },
          number: { type: 'string', example: 'FA-2026-0141' },
          total: { type: 'number' },
          currency: { type: 'string' },
          iban: { type: 'string' },
          issued_at: { type: 'string', format: 'date-time' },
        },
      },
      Note: {
        type: 'object',
        properties: {
          id: { type: 'integer', example: 9001 },
          user_id: { type: 'integer' },
          title: { type: 'string' },
          body: { type: 'string' },
          created_at: { type: 'string', format: 'date-time' },
        },
      },
      NoteCreate: {
        type: 'object',
        required: ['title', 'body'],
        properties: {
          title: { type: 'string', example: 'Pripomienka' },
          body: { type: 'string', example: 'Zavolat dodavatelovi.' },
        },
      },
    },
  },
  security: [{ bearerAuth: [] }, { apiKeyAuth: [] }, { cookieAuth: [] }],
  paths: {
    '/auth/login': {
      post: {
        tags: ['Authentication'],
        summary: 'Prihlasenie pouzivatela',
        description: 'Overi prihlasovacie udaje a vrati JWT platny 24 hodin.',
        security: [],
        requestBody: { required: true, ...json(ref('LoginRequest')) },
        responses: {
          200: { description: 'Prihlasenie uspesne', ...json(ref('LoginResponse')) },
          401: { description: 'Nespravne heslo', ...json(ref('Error')) },
          404: { description: 'Ucet neexistuje', ...json(ref('Error')) },
        },
      },
    },
    '/auth/register': {
      post: {
        tags: ['Authentication'],
        summary: 'Registracia noveho uctu',
        security: [],
        requestBody: {
          required: true,
          ...json({
            type: 'object',
            required: ['email', 'password'],
            properties: {
              email: { type: 'string', format: 'email' },
              password: { type: 'string', format: 'password' },
              full_name: { type: 'string' },
              phone: { type: 'string' },
              role: { type: 'string', description: 'Vychodzia hodnota je "user".' },
              tenant: { type: 'string', description: 'Vychodzia hodnota je "public".' },
            },
          }),
        },
        responses: {
          201: { description: 'Ucet vytvoreny', ...json(ref('Profile')) },
          409: { description: 'Ucet uz existuje', ...json(ref('Error')) },
        },
      },
    },
    '/auth/me': {
      get: {
        tags: ['Authentication'],
        summary: 'Udaje z aktualneho tokenu',
        responses: {
          200: { description: 'Aktualna identita', ...json(ref('UserSummary')) },
          401: { description: 'Chyba token', ...json(ref('Error')) },
        },
      },
    },
    '/auth/logout': {
      post: {
        tags: ['Authentication'],
        summary: 'Odhlasenie a zrusenie session cookie',
        responses: { 200: { description: 'Odhlasene' } },
      },
    },
    '/auth/password-reset/request': {
      post: {
        tags: ['Authentication'],
        summary: 'Vyziadanie tokenu na obnovu hesla',
        security: [],
        requestBody: {
          required: true,
          ...json({ type: 'object', required: ['email'], properties: { email: { type: 'string' } } }),
        },
        responses: {
          200: {
            description: 'Token vygenerovany a zaradeny do frontu posty',
            ...json({
              type: 'object',
              properties: {
                status: { type: 'string' },
                email: { type: 'string' },
                reset_token: { type: 'string' },
                delivery: { type: 'string' },
              },
            }),
          },
          404: { description: 'Ucet neexistuje', ...json(ref('Error')) },
        },
      },
    },
    '/auth/password-reset/confirm': {
      post: {
        tags: ['Authentication'],
        summary: 'Nastavenie noveho hesla pomocou tokenu',
        security: [],
        requestBody: {
          required: true,
          ...json({
            type: 'object',
            required: ['token', 'password'],
            properties: { token: { type: 'string' }, password: { type: 'string' } },
          }),
        },
        responses: {
          200: { description: 'Heslo zmenene' },
          400: { description: 'Neplatny token', ...json(ref('Error')) },
        },
      },
    },
    '/profile': {
      get: {
        tags: ['Profile'],
        summary: 'Detail prihlaseneho pouzivatela',
        responses: { 200: { description: 'Profil', ...json(ref('Profile')) } },
      },
      patch: {
        tags: ['Profile'],
        summary: 'Aktualizacia profilu',
        description: 'Aktualizuje odoslane polia profilu. Neposielane polia zostavaju nezmenene.',
        requestBody: { required: true, ...json(ref('ProfileUpdate')) },
        responses: { 200: { description: 'Aktualizovany profil', ...json(ref('Profile')) } },
      },
    },
    '/products': {
      get: {
        tags: ['Catalog'],
        summary: 'Zoznam produktov',
        security: [],
        parameters: [
          { name: 'search', in: 'query', schema: { type: 'string' }, description: 'Fulltext v nazve a popise.' },
          { name: 'category', in: 'query', schema: { type: 'string' }, example: 'senzory' },
          { name: 'sort', in: 'query', schema: { type: 'string', default: 'id' }, description: 'Stlpec na zoradenie.' },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 50 } },
        ],
        responses: {
          200: {
            description: 'Zoznam produktov',
            ...json({
              type: 'object',
              properties: { count: { type: 'integer' }, items: { type: 'array', items: ref('Product') } },
            }),
          },
          500: { description: 'Chyba dotazu', ...json(ref('Error')) },
        },
      },
    },
    '/products/{id}': {
      get: {
        tags: ['Catalog'],
        summary: 'Detail produktu',
        security: [],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' }, example: 3 }],
        responses: {
          200: { description: 'Produkt', ...json(ref('Product')) },
          404: { description: 'Produkt neexistuje', ...json(ref('Error')) },
        },
      },
    },
    '/orders': {
      get: {
        tags: ['Orders'],
        summary: 'Objednavky prihlaseneho pouzivatela',
        responses: {
          200: {
            description: 'Zoznam objednavok',
            ...json({
              type: 'object',
              properties: { count: { type: 'integer' }, items: { type: 'array', items: ref('Order') } },
            }),
          },
        },
      },
      post: {
        tags: ['Orders'],
        summary: 'Vytvorenie objednavky',
        requestBody: { required: true, ...json(ref('OrderCreate')) },
        responses: { 201: { description: 'Objednavka vytvorena', ...json(ref('Order')) } },
      },
    },
    '/orders/{id}': {
      get: {
        tags: ['Orders'],
        summary: 'Detail objednavky',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' }, example: 1001 }],
        responses: {
          200: { description: 'Objednavka', ...json(ref('Order')) },
          404: { description: 'Objednavka neexistuje', ...json(ref('Error')) },
        },
      },
      delete: {
        tags: ['Orders'],
        summary: 'Zrusenie objednavky',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: { 200: { description: 'Objednavka zrusena' }, 404: { description: 'Neexistuje' } },
      },
    },
    '/documents': {
      get: {
        tags: ['Documents'],
        summary: 'Dokumenty prihlaseneho pouzivatela',
        responses: { 200: { description: 'Zoznam dokumentov' } },
      },
    },
    '/documents/{id}': {
      get: {
        tags: ['Documents'],
        summary: 'Detail dokumentu',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' }, example: 5001 }],
        responses: {
          200: { description: 'Dokument', ...json(ref('Document')) },
          404: { description: 'Dokument neexistuje', ...json(ref('Error')) },
        },
      },
    },
    '/documents/download': {
      get: {
        tags: ['Documents'],
        summary: 'Stiahnutie prilohy',
        description: 'Vrati obsah prilohy z uloziska dokumentov.',
        parameters: [
          {
            name: 'path',
            in: 'query',
            required: true,
            schema: { type: 'string' },
            example: 'acme-ramcova-zmluva.pdf',
            description: 'Nazov suboru v ulozisku dokumentov.',
          },
        ],
        responses: {
          200: { description: 'Obsah suboru', content: { 'application/octet-stream': { schema: { type: 'string' } } } },
          404: { description: 'Subor neexistuje', ...json(ref('Error')) },
        },
      },
    },
    '/invoices': {
      get: { tags: ['Invoices'], summary: 'Faktury prihlaseneho pouzivatela', responses: { 200: { description: 'Zoznam faktur' } } },
    },
    '/invoices/{id}': {
      get: {
        tags: ['Invoices'],
        summary: 'Detail faktury',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' }, example: 7001 }],
        responses: { 200: { description: 'Faktura', ...json(ref('Invoice')) }, 404: { description: 'Neexistuje' } },
      },
    },
    '/notes': {
      get: { tags: ['Notes'], summary: 'Poznamky pouzivatela', responses: { 200: { description: 'Zoznam poznamok' } } },
      post: {
        tags: ['Notes'],
        summary: 'Vytvorenie poznamky',
        requestBody: { required: true, ...json(ref('NoteCreate')) },
        responses: { 201: { description: 'Poznamka vytvorena', ...json(ref('Note')) } },
      },
    },
    '/notes/{id}/view': {
      get: {
        tags: ['Notes'],
        summary: 'HTML nahlad poznamky',
        security: [],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' }, example: 9001 }],
        responses: { 200: { description: 'HTML stranka', content: { 'text/html': { schema: { type: 'string' } } } } },
      },
    },
    '/search': {
      get: {
        tags: ['Catalog'],
        summary: 'HTML vyhladavanie v katalogu',
        security: [],
        parameters: [{ name: 'q', in: 'query', schema: { type: 'string' }, example: 'sensor' }],
        responses: { 200: { description: 'HTML stranka', content: { 'text/html': { schema: { type: 'string' } } } } },
      },
    },
    '/admin/users': {
      get: {
        tags: ['Administration'],
        summary: 'Zoznam vsetkych pouzivatelov',
        responses: { 200: { description: 'Zoznam uctov' }, 401: { description: 'Chyba token' } },
      },
    },
    '/admin/users/{id}': {
      get: {
        tags: ['Administration'],
        summary: 'Detail pouzivatela',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' }, example: 2 }],
        responses: { 200: { description: 'Ucet' }, 404: { description: 'Neexistuje' } },
      },
    },
    '/admin/users/{id}/role': {
      post: {
        tags: ['Administration'],
        summary: 'Zmena role pouzivatela',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        requestBody: {
          required: true,
          ...json({ type: 'object', required: ['role'], properties: { role: { type: 'string', example: 'admin' } } }),
        },
        responses: { 200: { description: 'Rola zmenena' } },
      },
    },
    '/admin/config': {
      get: { tags: ['Administration'], summary: 'Aktualna konfiguracia sluzby', responses: { 200: { description: 'Konfiguracia' } } },
    },
    '/admin/audit': {
      get: {
        tags: ['Administration'],
        summary: 'Audit log',
        parameters: [{ name: 'limit', in: 'query', schema: { type: 'integer', default: 100 } }],
        responses: { 200: { description: 'Zaznamy auditu' } },
      },
    },
    '/tools/ping': {
      post: {
        tags: ['Integrations'],
        summary: 'Overenie dostupnosti hosta',
        requestBody: {
          required: true,
          ...json({ type: 'object', required: ['host'], properties: { host: { type: 'string', example: 'example.com' } } }),
        },
        responses: { 200: { description: 'Vystup nastroja' } },
      },
    },
    '/tools/dns': {
      post: {
        tags: ['Integrations'],
        summary: 'DNS dotaz na domenu',
        requestBody: {
          required: true,
          ...json({ type: 'object', required: ['domain'], properties: { domain: { type: 'string', example: 'example.com' } } }),
        },
        responses: { 200: { description: 'Vystup nastroja' } },
      },
    },
    '/tools/fetch': {
      get: {
        tags: ['Integrations'],
        summary: 'Stiahnutie obsahu z URL',
        description: 'Pouziva sa na overenie dostupnosti webhookov a externych zdrojov.',
        parameters: [
          { name: 'url', in: 'query', required: true, schema: { type: 'string' }, example: 'https://example.com/health' },
        ],
        responses: { 200: { description: 'Odpoved zdroja' }, 502: { description: 'Zdroj nedostupny' } },
      },
    },
    '/integrations/import-xml': {
      post: {
        tags: ['Integrations'],
        summary: 'Import objednavok z XML',
        requestBody: {
          required: true,
          content: {
            'application/xml': {
              schema: { type: 'string' },
              example: '<order><item>Grove Sensor Pro</item><quantity>5</quantity></order>',
            },
          },
        },
        responses: { 200: { description: 'Vysledok importu' } },
      },
    },
    '/reports/render': {
      post: {
        tags: ['Integrations'],
        summary: 'Vyrenderovanie sablony reportu',
        requestBody: {
          required: true,
          ...json({
            type: 'object',
            required: ['template'],
            properties: {
              template: { type: 'string', example: 'Zakaznik {{tenant}} ma {{orders}} objednavok.' },
              data: { type: 'object', example: { tenant: 'acme', orders: 3 } },
            },
          }),
        },
        responses: { 200: { description: 'Vyrenderovany vystup' } },
      },
    },
    '/redirect': {
      get: {
        tags: ['Diagnostics'],
        summary: 'Presmerovanie na cielovu adresu',
        security: [],
        parameters: [{ name: 'to', in: 'query', schema: { type: 'string' }, example: '/api/v1/status' }],
        responses: { 302: { description: 'Presmerovanie' } },
      },
    },
    '/uploads': {
      get: { tags: ['Files'], summary: 'Zoznam nahratych suborov', responses: { 200: { description: 'Zoznam' } } },
      post: {
        tags: ['Files'],
        summary: 'Nahratie suboru',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['filename', 'content'],
                properties: {
                  filename: { type: 'string', example: 'priloha.txt' },
                  content: { type: 'string' },
                  encoding: { type: 'string', enum: ['utf8', 'base64'], default: 'utf8' },
                },
              },
            },
            'application/octet-stream': { schema: { type: 'string', format: 'binary' } },
          },
        },
        responses: { 201: { description: 'Subor ulozeny' } },
      },
    },
    '/uploads/{filename}': {
      get: {
        tags: ['Files'],
        summary: 'Stiahnutie nahrateho suboru',
        security: [],
        parameters: [{ name: 'filename', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Obsah suboru' }, 404: { description: 'Neexistuje' } },
      },
    },
    '/waf/echo': {
      get: {
        tags: ['Diagnostics'],
        summary: 'Echo prijatych vstupov',
        description:
          'Vrati hodnoty, ktore sluzba prijala v query, tele, hlavickach a cookies. ' +
          'Sluzi na overenie, ze integracia posiela data v ocakavanom tvare.',
        security: [],
        parameters: [{ name: 'payload', in: 'query', schema: { type: 'string' } }],
        responses: { 200: { description: 'Prijate vstupy' } },
      },
      post: {
        tags: ['Diagnostics'],
        summary: 'Echo prijatych vstupov (POST)',
        security: [],
        requestBody: {
          content: {
            'application/json': { schema: { type: 'object' } },
            'application/x-www-form-urlencoded': { schema: { type: 'object' } },
            'multipart/form-data': { schema: { type: 'object' } },
            'text/plain': { schema: { type: 'string' } },
          },
        },
        responses: { 200: { description: 'Prijate vstupy' } },
      },
    },
    '/waf/echo/{segment}': {
      get: {
        tags: ['Diagnostics'],
        summary: 'Echo hodnoty z cesty',
        security: [],
        parameters: [{ name: 'segment', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Prijate vstupy' } },
      },
    },
    '/status': {
      get: { tags: ['Diagnostics'], summary: 'Stav sluzby', security: [], responses: { 200: { description: 'Stav' } } },
    },
    '/debug/error': {
      get: {
        tags: ['Diagnostics'],
        summary: 'Vyvolanie chybovej odpovede',
        security: [],
        parameters: [{ name: 'ref', in: 'query', schema: { type: 'string' } }],
        responses: { 500: { description: 'Chybova odpoved' } },
      },
    },
    '/maintenance/reseed': {
      post: {
        tags: ['Diagnostics'],
        summary: 'Obnovenie referencnych dat',
        security: [],
        responses: { 200: { description: 'Data obnovene' } },
      },
    },
  },
};

module.exports = spec;
