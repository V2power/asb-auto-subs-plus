export type AnimeMetaData = {
  anilistId?: number;
  episode: number;
  title: string;
};

export type Subs = {
  url: string;
  name: string;
  size: number;
  lastModified: string;
};

export type JimakuEntry = {
  id: number;
  name?: string;
  english_name?: string;
  japanese_name?: string;
};

export type AnilistObject = {
  data: {
    Page: {
      media: Array<{
        id: number;
        title: { romaji?: string | null; english?: string | null; native?: string | null };
        synonyms?: string[];
      }>;
    };
  };
};
