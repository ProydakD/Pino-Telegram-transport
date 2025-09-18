# Changelog

All notable changes to this project will be documented in this file. See [standard-version](https://github.com/conventional-changelog/standard-version) for commit guidelines.

### [1.3.1](https://github.com/ProydakD/pino-telegram-transport/compare/v1.3.0...v1.3.1) (2025-09-18)

## [1.3.0](https://github.com/ProydakD/pino-telegram-transport/compare/v1.2.0...v1.3.0) (2025-09-18)


### Features

* **examples:** добавлен пример повторных попыток отправки сообщений в Telegram ([1717740](https://github.com/ProydakD/pino-telegram-transport/commit/1717740df49ae2b1a2c8ff88401188ad5a8fb0ea))
* **telegram:** добавлена поддержка sendPhoto и sendDocument через TelegramRequest ([e152909](https://github.com/ProydakD/pino-telegram-transport/commit/e1529094e1db5c5ad2bd80170a5975e5a872c591))


### Bug Fixes

* **formatter:** заменён значок ERROR на ❗ ([a6a5179](https://github.com/ProydakD/pino-telegram-transport/commit/a6a517951eae7975986578dd98fbaf0bf67f9c40))


### Tests

* **transport:** обновлены тесты Telegram-транспорта ([1b60998](https://github.com/ProydakD/pino-telegram-transport/commit/1b60998257c45c8bf5f93f9797f4444488459b3b))


### Documentation

* **changelog:** добавлена секция "Unreleased" и описаны новые возможности и примеры отправки медиа ([80606dd](https://github.com/ProydakD/pino-telegram-transport/commit/80606ddaddd15cc2d831182592205dcbe19f821b))
* **docs:** обновлена документация по установке, использованию и конфигурации ([ab8b1a1](https://github.com/ProydakD/pino-telegram-transport/commit/ab8b1a1d8e7799a03c7f0e51ece56e50a2736826))
* **docs:** обновлена документация по установке, использованию и конфигурации ([514b0d2](https://github.com/ProydakD/pino-telegram-transport/commit/514b0d2db56241907ed154145d1f1b8aed4703f0))
* **examples:** добавлен пример кастомных ключей для медиа ([dc52a37](https://github.com/ProydakD/pino-telegram-transport/commit/dc52a37e4669a80ee4a6e0809e378b33a9f65e4a))
* **usage:** удалён обработчик onDeliveryError из примера кода ([310232b](https://github.com/ProydakD/pino-telegram-transport/commit/310232bcb7e95d92ded0b9c64774ed6b7b48e71e))

## [1.2.0](https://github.com/ProydakD/pino-telegram-transport/compare/v1.1.0...v1.2.0) (2025-09-18)

### Features

- **transport:** добавлена поддержка повторных попыток отправки с экспоненциальным бэкоффом и иконки уровней логирования ([33a626d](https://github.com/ProydakD/pino-telegram-transport/commit/33a626da252c28d1114bb2eee54704d431fb2056))

## [1.1.0](https://github.com/ProydakD/pino-telegram-transport/compare/v1.0.4...v1.1.0) (2025-09-18)

### Features

- **transport:** транспорт отключается при отсутствии botToken или chatId ([73037a3](https://github.com/ProydakD/pino-telegram-transport/commit/73037a37d3f889a4e6d3f53db88accc0c839f582))

### [1.0.4](https://github.com/ProydakD/pino-telegram-transport/compare/v1.0.3...v1.0.4) (2025-09-18)

### Chores

- **package:** имя пакета изменено на pino-telegram-logger-transport ([cd0f440](https://github.com/ProydakD/pino-telegram-transport/commit/cd0f4404a19b0c342ed9b9ecbb09bc9bf5df08b2))

### [1.0.3](https://github.com/ProydakD/pino-telegram-transport/compare/v1.0.2...v1.0.3) (2025-09-18)

### Chores

- **gitignore:** добавлено исключение для CHANGELOG.md ([b2f25ef](https://github.com/ProydakD/pino-telegram-transport/commit/b2f25efe3016e9575c9b8832bcf67e9558b58869))
- **package:** переименован пакет в pino-telegram-logger-transport и обновлены ссылки ([a23b461](https://github.com/ProydakD/pino-telegram-transport/commit/a23b461d22f8ba7323cbbf2f4bcb984b17068077))

### 1.0.2 (2025-09-18)

### Chores

- **package:** заполнены метаданные пакета и обновлён заголовок README ([e71e507](https://github.com/ProydakD/pino-telegram-transport/commit/e71e507bb7120adf6aebc2da08d59ada34534ea9))
- **repo:** initial project setup ([aefc922](https://github.com/ProydakD/pino-telegram-transport/commit/aefc9223063c214fad1d9104aa123c06113a8c8e))

### 1.0.1 (2025-09-18)

### Chores

- **package:** заполнены метаданные пакета и обновлён заголовок README ([e71e507](https://github.com/ProydakD/pino-telegram-transport/commit/e71e507bb7120adf6aebc2da08d59ada34534ea9))
- **repo:** initial project setup ([aefc922](https://github.com/ProydakD/pino-telegram-transport/commit/aefc9223063c214fad1d9104aa123c06113a8c8e))
