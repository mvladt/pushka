/**
 * Проверяет, что `datetime` задан и парсится в корректную дату.
 * Кидает ошибку с понятным сообщением, если это не так.
 */
export const validateDatetime = (datetime: string): void => {
  if (!datetime) {
    throw new Error("Параметр 'datetime' — обязательный.");
  }
  if (String(new Date(datetime)) === "Invalid Date") {
    throw new Error(
      "Параметр 'datetime' — значение некорректно. Должно быть в формате `YYYY-MM-DDTHH:mm:ss.sssZ`."
    );
  }
};
