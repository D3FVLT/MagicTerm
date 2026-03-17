# Полный гайд по настройке Supabase для MagicTerm

## 1. Создание проекта

1. Перейди на [supabase.com](https://supabase.com) и войди/зарегистрируйся
2. Нажми **New Project**
3. Заполни:
   - **Name**: `magicterm` (или любое другое)
   - **Database Password**: сгенерируй надёжный пароль и сохрани его
   - **Region**: выбери ближайший (например `Frankfurt (eu-central-1)`)
4. Нажми **Create new project**
5. Подожди 1-2 минуты пока проект создаётся

## 2. Получение ключей API

### Новая система ключей (2025+)

Supabase обновил систему API ключей:

| Тип ключа | Формат | Использование |
|-----------|--------|---------------|
| **Publishable key** | `sb_publishable_...` | Клиентские приложения (наш случай) |
| **Secret key** | `sb_secret_...` | Только серверный код |

### Шаги:

1. В sidebar нажми **Project Settings** (иконка шестерёнки)
2. Перейди в **API Keys**
3. Скопируй:
   - **Project URL** (вверху страницы или в Project Settings → General) → это `VITE_SUPABASE_URL`
   - **Publishable key** (`sb_publishable_...`) → это `VITE_SUPABASE_ANON_KEY`

> ⚠️ **Важно**: Используй именно **Publishable key**, а не Secret key!

4. Создай файл `.env` в `apps/desktop/`:

```bash
cd apps/desktop
cp .env.example .env
```

5. Заполни `.env`:

```env
VITE_SUPABASE_URL=https://xxxxxxxxxxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_Q4DGz...
```

### Legacy ключи

Если у тебя старый проект с `anon`/`service_role` ключами - они всё ещё работают.
Найти их можно во вкладке **Legacy anon, service_role API keys**.

## 3. Создание схемы базы данных

1. В sidebar нажми **SQL Editor**
2. Нажми **New query**
3. Скопируй ВЕСЬ контент из файла `supabase/schema.sql`
4. Нажми **Run** (или `Cmd+Enter`)
5. Убедись что нет ошибок (зелёная галочка)

### Дополнительные миграции

После основной схемы, выполни дополнительные SQL файлы в том же порядке:

1. `supabase/add-user-profiles.sql` — профили пользователей
2. `supabase/add-user-settings.sql` — настройки пользователей (ник, дефолтная орга)
3. `supabase/add-snippets.sql` — персональные зашифрованные сниппеты

### Проверка таблиц

После выполнения SQL, в **Table Editor** должны появиться таблицы:
- `organizations`
- `org_members`  
- `servers`
- `user_profiles`
- `snippets`

## 4. Настройка аутентификации

### 4.1 Email аутентификация

1. В sidebar: **Authentication** → **Providers**
2. **Email** должен быть включён по умолчанию
3. Опционально: отключи **Confirm email** для разработки
   - Authentication → Settings → отключи "Enable email confirmations"

### 4.2 GitHub OAuth (опционально)

1. Перейди на [github.com/settings/developers](https://github.com/settings/developers)
2. Нажми **New OAuth App**
3. Заполни:
   - **Application name**: `MagicTerm`
   - **Homepage URL**: `https://xxxxxxxxxxxxx.supabase.co`
   - **Authorization callback URL**: `https://xxxxxxxxxxxxx.supabase.co/auth/v1/callback`
4. Нажми **Register application**
5. Скопируй **Client ID**
6. Нажми **Generate a new client secret** и скопируй его

7. Вернись в Supabase:
   - Authentication → Providers → GitHub
   - Включи GitHub
   - Вставь Client ID и Client Secret
   - Нажми **Save**

## 5. Настройка Row Level Security (RLS)

RLS уже настроен в `schema.sql`, но проверь что он включён:

1. **Table Editor** → выбери таблицу `servers`
2. В правом верхнем углу должно быть "RLS Enabled"
3. Повтори для `organizations` и `org_members`

## 6. Настройка Realtime

Realtime нужен для синхронизации между устройствами:

1. **Database** → **Replication**
2. Убедись что включены таблицы:
   - `servers`
   - `organizations`
   - `org_members`

Или выполни в SQL Editor:

```sql
-- Проверка что realtime включён
select * from pg_publication_tables where pubname = 'supabase_realtime';
```

## 7. Тестирование

### 7.1 Тест регистрации

1. Запусти приложение:
```bash
cd /Users/white/Work/MagicTerm
pnpm dev
```

2. Зарегистрируйся с email/паролем
3. Проверь в Supabase: **Authentication** → **Users** - должен появиться твой юзер

### 7.2 Тест создания сервера

1. Установи master password
2. Добавь тестовый сервер
3. Проверь в **Table Editor** → `servers` - должна появиться запись
4. Поля `host`, `username`, `credentials` должны быть зашифрованы (выглядят как base64)

### 7.3 Тест организаций

1. Создай организацию
2. Проверь в `organizations` - появилась запись
3. Проверь в `org_members` - ты добавлен как `owner`

## 8. Безопасность (Production)

### 8.1 Настрой домен

1. **Authentication** → **URL Configuration**
2. **Site URL**: URL твоего приложения (для OAuth редиректов)

### 8.2 Ограничь регистрацию (опционально)

Если хочешь закрытую систему только для инвайтов:

1. **Authentication** → **Settings**
2. Отключи **Enable sign up**
3. Новые пользователи смогут войти только после получения инвайта

### 8.3 Настрой email templates

1. **Authentication** → **Email Templates**
2. Настрой шаблоны писем под свой бренд

## 9. Troubleshooting

### Ошибка "relation does not exist"

SQL схема не выполнена. Перейди в SQL Editor и запусти `schema.sql` снова.

### Ошибка "permission denied"

RLS блокирует доступ. Проверь что:
1. Пользователь авторизован
2. RLS политики созданы правильно

Для дебага временно отключи RLS:
```sql
alter table servers disable row level security;
```

### Данные не синхронизируются

1. Проверь Realtime в Database → Replication
2. Проверь что WebSocket подключение работает в DevTools

### Не работает GitHub OAuth

1. Проверь callback URL в GitHub OAuth App
2. Убедись что Client ID/Secret введены правильно
3. В Supabase должен быть тот же redirect URL

## 10. Полезные SQL запросы

```sql
-- Посмотреть всех пользователей
select * from auth.users;

-- Посмотреть все организации с владельцами
select o.*, u.email as owner_email 
from organizations o
join auth.users u on o.owner_id = u.id;

-- Посмотреть членов организации
select om.*, u.email
from org_members om
left join auth.users u on om.user_id = u.id
where org_id = 'uuid-организации';

-- Удалить все тестовые данные
truncate servers, org_members, organizations cascade;
```

## Готово!

После всех настроек твоя архитектура выглядит так:

```
┌─────────────────┐     ┌─────────────────────────────┐
│  MagicTerm App  │────▶│         Supabase            │
│  (Electron)     │     │                             │
│                 │     │  ┌─────────────────────┐    │
│  ┌───────────┐  │     │  │   PostgreSQL        │    │
│  │ E2E Crypto│──┼────▶│  │   - organizations   │    │
│  │ (AES-256) │  │     │  │   - org_members     │    │
│  └───────────┘  │     │  │   - servers (encrypted)│ │
│                 │     │  └─────────────────────┘    │
│  ┌───────────┐  │     │                             │
│  │  ssh2     │  │     │  ┌─────────────────────┐    │
│  │  xterm.js │  │     │  │   Auth (JWT)        │    │
│  └───────────┘  │     │  │   - email/password  │    │
│                 │     │  │   - GitHub OAuth    │    │
└─────────────────┘     │  └─────────────────────┘    │
                        │                             │
                        │  ┌─────────────────────┐    │
                        │  │   Realtime          │    │
                        │  │   (WebSocket sync)  │    │
                        │  └─────────────────────┘    │
                        └─────────────────────────────┘
```

Все credentials шифруются на клиенте до отправки. Supabase никогда не видит plaintext пароли от серверов.
