import { GetMenuResponse } from "@workspace/api-zod";
import rawMenu from "../data/menus.json";
import { KioskError } from "./errors";

export const menu = GetMenuResponse.parse(rawMenu);
export type Menu = (typeof menu)[number];
export type Temperature = "ice" | "hot";

export function findMenu(menuId: string): Menu {
  const item = menu.find((entry) => entry.menuId === menuId);
  if (!item) throw new KioskError("MENU_UNKNOWN", "판매 중인 메뉴를 찾지 못했습니다. 화면에서 메뉴를 선택해주세요.");
  return item;
}

export function validateSelection(menuId: string, temperature: Temperature, size: string, optionIds: string[]) {
  const product = findMenu(menuId);
  if (!product.availableTemperatures.includes(temperature)) {
    throw new KioskError("TEMPERATURE_INVALID", `${product.name}의 온도를 다시 선택해주세요.`);
  }
  const sizeOption = product.availableSizes.find((entry) => entry.id === size);
  if (!sizeOption) throw new KioskError("SIZE_INVALID", `${product.name}의 크기를 다시 선택해주세요.`);
  if (new Set(optionIds).size !== optionIds.length) {
    throw new KioskError("OPTIONS_DUPLICATE", "같은 옵션을 두 번 선택할 수 없습니다.");
  }
  const options = optionIds.map((id) => {
    const option = product.availableOptions.find((entry) => entry.id === id);
    if (!option) throw new KioskError("OPTION_INVALID", `${product.name}에서 선택할 수 없는 옵션입니다.`);
    return option;
  });
  for (const pair of [["oat_milk", "soy_milk"], ["less_ice", "extra_ice"]]) {
    if (pair.every((id) => optionIds.includes(id))) {
      throw new KioskError("OPTION_CONFLICT", "함께 선택할 수 없는 옵션이 있습니다. 우유 또는 얼음 옵션을 하나만 선택해주세요.");
    }
  }
  if (temperature === "hot" && optionIds.some((id) => id === "less_ice" || id === "extra_ice")) {
    throw new KioskError("OPTION_CONFLICT", "따뜻한 음료에는 얼음 옵션을 선택할 수 없습니다.");
  }
  return { product, options, unitPrice: product.price + sizeOption.price + options.reduce((sum, o) => sum + o.price, 0) };
}
