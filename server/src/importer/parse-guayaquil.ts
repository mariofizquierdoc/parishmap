import * as cheerio from 'cheerio';

export interface ParsedParish {
  /** Vicariate name in uppercase, as the page's heading shows it. */
  vicariate: string;
  /** Text as published, without its list number. Used to match on re-import. */
  sourceName: string;
  /** Display name: sourceName with extra spaces removed. */
  name: string;
}

const HEADING = /PARROQUIAS VICAR[ÍI]A\s+(.+?)\s*-\s*GUAYAQUIL/i;
const LIST_NUMBER = /^\s*\d+\.\s*/;

/**
 * Reads parish names from the archdiocese's page.
 *
 * Each vicariate is a popup holding two columns: an <ol>, and a <p> whose lines are separated
 * by <br> and carry a typed-in number such as "13. Sagrada Familia". Both must be read.
 */
export function parseGuayaquilPage(html: string): ParsedParish[] {
  const $ = cheerio.load(html);
  const parishes: ParsedParish[] = [];

  $('[data-elementor-type="popup"]').each((_, popup) => {
    const section = $(popup);
    const heading = section
      .find('h1, h2, h3, h4')
      .toArray()
      .map((el) => HEADING.exec($(el).text()))
      .find((match) => match !== null);
    if (!heading?.[1]) return;
    const vicariate = heading[1].trim().toUpperCase();

    const rawNames: string[] = [];
    section.find('ol > li').each((_, li) => {
      rawNames.push($(li).text());
    });
    section.find('.elementor-widget-text-editor p').each((_, p) => {
      const paragraph = $(p).clone();
      paragraph.find('br').replaceWith('\n');
      rawNames.push(...paragraph.text().split('\n'));
    });

    for (const raw of rawNames) {
      const sourceName = raw.replace(LIST_NUMBER, '').trim();
      if (sourceName) {
        parishes.push({ vicariate, sourceName, name: sourceName.replace(/\s+/g, ' ') });
      }
    }
  });

  return parishes;
}
