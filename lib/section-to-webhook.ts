import { strict as assert } from "assert";
import cheerio from "cheerio";
import TurndownService from "turndown";
import { Section, Webhook } from ".";

import type { JSONSchema7TypeName } from "json-schema";

const turndownService = new TurndownService({
  codeBlockStyle: "fenced",
});

const isObsoleteEvent = ($: cheerio.Root): boolean =>
  $(".warning").text().includes("Events of this type are no longer delivered");

export const toWebhook = (section: Section): Webhook | null => {
  const $ = cheerio.load(section.html);

  // ignore obsolete events that are no longer sent
  if (isObsoleteEvent($)) {
    return null;
  }

  // rewrite local links to /en/rest* as fully-qualified URLs
  $("a").each((i, element) => {
    const url = $(element).attr("href");

    assert.ok(url, `${element} has no url attribute`);

    if (url.startsWith("/en/rest")) {
      $(element).attr(
        "href",
        url.replace("/en/rest", "https://docs.github.com/en/rest")
      );
    }
  });

  return {
    name: getName($),
    description: getDescription($),
    properties: getProperties($),
    actions: getActions($),
    examples: getExamples($),
  };
};

const getName = ($: cheerio.Root): string => $("h3").text().trim();

const getDescription = ($: cheerio.Root): string =>
  $("h3")
    .nextUntil("h4")
    .filter("p")
    .map((i, el) => $(el).html())
    .get()
    .map((html) => turndownService.turndown(html))
    .join("\n\n");

const getPropertiesEl = ($: cheerio.Root): cheerio.Element[][] => {
  const $table = $('[id^="webhook-payload-object"]').next("table");

  if (!$table.is("table")) {
    return [];
  }

  return $table.find("tbody tr").get() as cheerio.Element[][];
};

const getProperties = ($: cheerio.Root): Webhook["properties"] => {
  const propertiesEl = getPropertiesEl($);
  const properties: Webhook["properties"] = {};

  const accessByString = (
    str: string,
    value: {
      type: JSONSchema7TypeName;
      description: string;
    },
    obj: { [key: string]: any }
  ) => {
    const matches = [...str.matchAll(/(\w+)/g)];
    return matches.reduce((cursor, [, key], index) => {
      if (index + 1 === matches.length) {
        return (cursor[key] = value);
      }
      return (cursor[key] = { ...cursor[key] });
    }, obj);
  };

  propertiesEl.forEach((propertyEl) => {
    const [keyEl, typeEl, descriptionEl] = $(propertyEl)
      .find("td")
      .get() as cheerio.Element[];
    const key = $(keyEl).text();
    if (key !== "action") {
      const type = $(typeEl).text() as JSONSchema7TypeName;
      const description = turndownService.turndown(
        $(descriptionEl).html() ?? ""
      );

      accessByString(key, { type, description }, properties);
      //properties[key] = { type, description };
    }
  });

  return properties;
};
const getActions = ($: cheerio.Root): string[] => {
  const unwantedActions = ["true", "false", "status"];

  const [keyEl, , descriptionEl] = $(getPropertiesEl($)[0])
    .find("td")
    .get() as cheerio.Element[];

  if ($(keyEl).text().trim() !== "action") {
    return [];
  }

  const desc = $(descriptionEl).html();

  assert.ok(desc, `${descriptionEl} has no description!`);

  const actions: string[] = (cheerio
    .load(desc)("code")
    .map((index, el) => $(el).text().trim())
    .get() as string[])
    .filter((action) => !unwantedActions.includes(action))
    .sort((a, b) => a.localeCompare(b));

  // return unique actions
  return [...new Set(actions)];
};

const getExamples = ($: cheerio.Root) =>
  $(".language-json")
    .map((index, el) => JSON.parse($(el).text()) as unknown)
    .get() as object[];
