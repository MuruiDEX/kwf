# KWF — Kyokushin Tournament Platform

Профессиональная двуязычная (RU/KK) платформа для организации и проведения
турниров по киокушин-карате: от заявки и взвешивания до сеток,
realtime-табло, рейтингов и дипломов с QR-проверкой.

Принцип: **сложное внутри — простое снаружи**. Каждый экран решает одну задачу.

## Возможности

- **Турниры**: жизненный цикл upcoming → registration → live → finished с проверками переходов
- **Smart Builder**: категории, посев по рейтингу, сетки single elimination 4–128 с auto-bye, автораспределение по татами, расписание с детекцией конфликтов и предложениями решений
- **Live**: SSE, таймер судьи, TV-табло для большого экрана, режим судьи с большими кнопками
- **Взвешивание и check-in**: статусы В норме / Перевес / Недовес, one-tap отметка явки, уведомления о проблемах
- **Рейтинги**: автопересчёт после каждого боя (победы, поражения, титулы), фильтры пол/страна/вес
- **Документы**: дипломы и протоколы PDF с QR-кодом, публичная проверка `/verify`
- **Импорт/экспорт**: CSV/XLSX с превью и разбором ошибок, протокол PDF, расписание CSV
- **Доступ**: регистрация (спортсмен/тренер/судья), организатор — только через заявку + одобрение админа
- **Аудит**: журнал критических действий; rate limiting; security-заголовки
- **Автоотчёт**: статистика турнира + черновик новости в один клик

## Стек

Frontend: React 18 + TypeScript + Vite, React Router, Tailwind CSS,
TanStack Query, Lucide Icons.
Backend: FastAPI + SQLAlchemy 2 + Pydantic v2, JWT в HttpOnly-cookie,
SQLite для dev / PostgreSQL для prod.
Realtime: SSE (`/api/tournaments/{id}/live/stream`).

## Быстрый старт (локально)

```bash
# backend
cd backend
/Library/Frameworks/Python.framework/Versions/3.14/bin/python3 seed.py  # демо-данные (или свой python3)
/Library/Frameworks/Python.framework/Versions/3.14/bin/python3 -m uvicorn app.main:app --reload
# frontend (вторым терминалом)
cd frontend && npm install && npm run dev
```

Открыть: http://127.0.0.1:5173 · API docs: http://127.0.0.1:8000/api/docs

Демо-доступ:

| Роль | Email | Пароль |
|---|---|---|
| Организатор | organizer@kwf.org | organizer123 |
| Админ | admin@kwf.org | admin123 |

## Docker

```bash
docker compose up --build
# frontend: http://localhost:5173, backend: http://localhost:8000
```

## Тесты

```bash
cd backend && python3 -m pytest tests -q
cd frontend && npm run build  # tsc + production build
```

Покрыто: E2E жизненного цикла турнира (§43: создание → сетки → расписание →
финиш боя → продвижение победителя → live → диплом), посев/bye, рейтинг,
XLSX-импорт, уведомления, таймер, check-in, новости, жизненный цикл статусов,
доступ организаторов, rate limiting, профили.

## Структура

```
backend/
  app/
    api/        # auth, tournaments, core, live, exports, admin
    core/       # config, db, deps (auth), security, ratelimit, lang
    models/     # user, club_athlete, tournament, competition, misc
    services/   # seeding, brackets, schedule, ranking, validation, notifications, live
    schemas/    # pydantic-схемы
  tests/        # pytest (общая изолированная БД в tests/db.py)
  seed.py       # демо-данные
frontend/
  src/
    pages/      # Home, Tournaments, TournamentDetail, Lists, TvReferee, Organizer, Documents
    components/ # ui: Header, CommandMenu, core, tournament
    i18n.tsx    # словарь RU/KK + переключатель языка
```

## Гид организатора

День турнира за 9 шагов — см. ниже.

### 0. Доступ

`/me` → вход или регистрация (спортсмен/тренер/судья). Стать организатором —
блок «Стать организатором», заявку одобряет админ. Быстрые действия: `Ctrl/⌘+K`.

### 1–3. Турнир → категории → участники

`/organizer` → создать турнир. Категории (пример: Men −70kg). Участники:
вручную, CSV/XLSX-импорт с превью или API. Предупреждения о несоответствии
веса/возраста/пола — сразу, не молча.

### 4. Check-in + взвешивание

«Участники» → отметить явку. «Взвешивание» → поиск → вес → статус.
Перевес/недовес = уведомление организатору.

### 5–6. Сетки + расписание

«Обзор» → сгенерировать сетки (посев, bye) → сгенерировать расписание
(по татами). Конфликты — с предложением решения.

### 7. Старт

Кнопка следующего статуса. Без сеток в эфир не пустит, с недоконченными
боями не закроет — с объяснением причины.

### 8. Live и судейство

`/referee` — таймер, счёт, финиш (рейтинг сам). `/tv/:id` — табло + fullscreen.
Вкладка «Эфир» — очередь и лента без перезагрузки.

### 9. Финиш

«Завершить турнир» → «Результаты»: чемпионы, медальный зачёт, автоотчёт,
новость в один клик, экспорты, дипломы с QR (`/verify` для проверки).

## API-карта

```
/api/auth/*                 регистрация, вход, /me, заявка организатора
/api/admin/organizer-requests*  одобрение заявок (админ)
/api/tournaments             CRUD + категории, регистрации, импорт
/api/tournaments/{id}/weigh-in/{reg}  взвешивание
/api/tournaments/{id}/check-in/{reg}  явка
/api/tournaments/{id}/brackets*       генерация + просмотр сеток
/api/tournaments/{id}/schedule/generate, /conflicts, /validate, /status, /results, /report
/api/tournaments/matches/{mid}/finish, /timer
/api/tournaments/{id}/export/*        participants.csv/xlsx, schedule.csv, protocol.pdf
/api/athletes[/{id}]  /api/clubs[/{id}]  /api/rankings  /api/news  /api/search
/api/documents/issue, /verify/{code}, /{code}/certificate.pdf
/api/notifications  /api/audit
```

Язык сообщений сервера: заголовок `Accept-Language: kk` (фронтенд ставит сам
по переключателю Рус/Каз).
