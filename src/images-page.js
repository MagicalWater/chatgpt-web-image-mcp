import { CHAT_SURFACE_SELECTORS, ChatGPTPage } from "./chatgpt-page.js";

export const IMAGES_SURFACE_SELECTORS = Object.freeze({
  ...CHAT_SURFACE_SELECTORS,
  image: "[class~='group/imagegen-image'] img",
  attach: [
    CHAT_SURFACE_SELECTORS.attach,
    "button[aria-label='Attach image']",
    "button[aria-label='附加图片']",
  ].join(", "),
});

export class ImagesPage extends ChatGPTPage {
  constructor(page, config) {
    super(page, config, IMAGES_SURFACE_SELECTORS);
  }
}
