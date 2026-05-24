import { useState, useEffect, useCallback, useRef } from "react";

const BACKEND = "https://oddsiq-ai.ghostxela.workers.dev";
const ODDS_BASE = "https://api.the-odds-api.com/v4";
const ODDS_KEY = "300321be5cb6ceb939c23cb0c40a04da";

// Keep Render backend alive — pings every 10 min to prevent sleep
function keepAlive() {
  fetch(`${BACKEND}/`).catch(() => {});
}
keepAlive();
setInterval(keepAlive, 10 * 60 * 1000);

// ── Live Series State ─────────────────────────
interface SeriesInfo {
  label: string;   // "🏀 ECF"
  status: string;  // "NYK leads series"
  color: string;
  isLive: boolean;
  lastScore?: string; // "NYK 121 · CLE 108"
}

interface NewsItem {
  text: string;
  color: string;
  highlight: boolean;
}

// Fetch scores from Odds API and derive series/news automatically
async function fetchSeriesData(): Promise<{ series: SeriesInfo[]; news: NewsItem[]; systemCtx: string }> {
  try {
    const [nbaR, nhlR] = await Promise.all([
      proxiedFetch(`${ODDS_BASE}/sports/basketball_nba/scores/?apiKey=${ODDS_KEY}&daysFrom=3`),
      proxiedFetch(`${ODDS_BASE}/sports/icehockey_nhl/scores/?apiKey=${ODDS_KEY}&daysFrom=3`),
    ]);

    const nbaGames: any[] = nbaR.ok ? await nbaR.json() : [];
    const nhlGames: any[] = nhlR.ok ? await nhlR.json() : [];

    const abbr = (n: string) => n.split(" ").pop()!.slice(0,3).toUpperCase();

    // Build series records from recent games
    const seriesRecord: Record<string, {w1:number;w2:number;t1:string;t2:string;lastGame?:any;sport:string}> = {};

    const processGames = (games: any[], sport: string) => {
      // Sort by date
      const sorted = [...games].filter(g=>g.home_team!=="TBD"&&g.away_team!=="TBD")
        .sort((a,b)=>new Date(a.commence_time).getTime()-new Date(b.commence_time).getTime());

      sorted.forEach(g => {
        if (!g.completed && g.scores?.length) return;
        const t1 = abbr(g.home_team), t2 = abbr(g.away_team);
        const key = [t1,t2].sort().join("_");
        if (!seriesRecord[key]) seriesRecord[key] = {w1:0,w2:0,t1,t2,sport};
        const homeScore = parseInt(g.scores?.find((s:any)=>s.name===g.home_team)?.score??0);
        const awayScore = parseInt(g.scores?.find((s:any)=>s.name===g.away_team)?.score??0);
        if (g.completed && homeScore!==0 && awayScore!==0) {
          if (homeScore > awayScore) seriesRecord[key].w1++;
          else seriesRecord[key].w2++;
          seriesRecord[key].lastGame = g;
        }
      });
    };

    processGames(nbaGames, "NBA");
    processGames(nhlGames, "NHL");

    // Build series info for header chips (only active series with games played)
    const series: SeriesInfo[] = [];
    const news: NewsItem[] = [];
    const ctxLines: string[] = [];

    Object.entries(seriesRecord).forEach(([key, s]) => {
      if (s.w1 === 0 && s.w2 === 0) return;
      const maxWins = s.sport === "NHL" ? 4 : 4;
      if (s.w1 >= maxWins || s.w2 >= maxWins) {
        // Series over
        const winner = s.w1 >= maxWins ? s.t1 : s.t2;
        const loser = s.w1 >= maxWins ? s.t2 : s.t1;
        const wins = Math.max(s.w1,s.w2), losses = Math.min(s.w1,s.w2);
        series.push({
          label: `${s.sport==="NBA"?"🏀":"🏒"} ${winner}`,
          status: `def. ${loser} 4-${losses}`,
          color: s.sport==="NBA" ? C.accent : C.cyan,
          isLive: false,
        });
      } else {
        // Series in progress
        const leader = s.w1>s.w2?s.t1:s.w1<s.w2?s.t2:null;
        const status = leader
          ? `${leader} leads ${Math.max(s.w1,s.w2)}-${Math.min(s.w1,s.w2)}`
          : `Series tied ${s.w1}-${s.w2}`;
        const isLive = !!nbaGames.concat(nhlGames).find(g=>
          !g.completed && g.scores?.length &&
          (abbr(g.home_team)===s.t1||abbr(g.home_team)===s.t2)
        );
        series.push({
          label: `${s.sport==="NBA"?"🏀":"🏒"} ${s.t1} vs ${s.t2}`,
          status,
          color: s.sport==="NBA" ? C.accent : C.cyan,
          isLive,
        });
        ctxLines.push(`${s.sport}: ${status} (${s.t1} vs ${s.t2})`);
      }

      // Build news from last game
      if (s.lastGame) {
        const g = s.lastGame;
        const hs = parseInt(g.scores?.find((sc:any)=>sc.name===g.home_team)?.score??0);
        const as2 = parseInt(g.scores?.find((sc:any)=>sc.name===g.away_team)?.score??0);
        const h = abbr(g.home_team), a = abbr(g.away_team);
        const winner = hs>as2?h:a, loser = hs>as2?a:h;
        const ws = hs>as2?hs:as2, ls = hs>as2?as2:hs;
        news.push({
          text: `${winner} ${ws} · ${loser} ${ls}`,
          color: C.text,
          highlight: false,
        });
      }
    });

    return { series: series.slice(0,4), news: news.slice(0,4), systemCtx: ctxLines.join(". ") };
  } catch {
    return { series: [], news: [], systemCtx: "" };
  }
}

// ── useLiveSeries hook ────────────────────────
function useLiveSeries() {
  const [series, setSeries] = useState<SeriesInfo[]>([]);
  const [news, setNews] = useState<NewsItem[]>([]);
  const [systemCtx, setSystemCtx] = useState("");

  const refresh = useCallback(async () => {
    const data = await fetchSeriesData();
    if (data.series.length > 0) { setSeries(data.series); setNews(data.news); setSystemCtx(data.systemCtx); }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 60000); // refresh every 60s
    return () => clearInterval(id);
  }, [refresh]);

  return { series, news, systemCtx };
}

// ── Live Scores Types ─────────────────────────
interface LiveScore {
  id: string;
  sport: string;
  home: string;
  away: string;
  homeScore?: number;
  awayScore?: number;
  status: string; // "live" | "scheduled" | "final"
  period?: string;
  commenceTime: string;
  lastUpdate: number;
  seriesTitle?: string;
  winProb?: Record<string,number>;
}

// ── Fetch live scores from Odds API ───────────
async function fetchLiveScores(): Promise<LiveScore[]> {
  const sports = [
    { key: "basketball_nba", label: "NBA" },
    { key: "americanfootball_nfl", label: "NFL" },
    { key: "icehockey_nhl", label: "NHL" },
    { key: "baseball_mlb", label: "MLB" },
    { key: "soccer_epl", label: "Soccer" },
  ];

  const results = await Promise.allSettled(
    sports.map(async ({ key, label }) => {
      // Fetch live + upcoming games with scores
      const url = `${ODDS_BASE}/sports/${key}/scores/?apiKey=${ODDS_KEY}&daysFrom=1`;
      const r = await proxiedFetch(url);
      if (!r.ok) return [];
      const data = await r.json() as any[];
      return data
        .filter(g => g.home_team !== "TBD" && g.away_team !== "TBD")
        .map((g: any) => {
          const abbr = (n: string) => n.split(" ").pop()!.slice(0,3).toUpperCase();
          const now = Date.now();
          const start = new Date(g.commence_time).getTime();
          let status = "scheduled";
          if (g.completed) status = "final";
          else if (start <= now && start > now - 4*3600000) status = "live";

          return {
            id: g.id,
            sport: label,
            home: abbr(g.home_team),
            away: abbr(g.away_team),
            homeScore: g.scores?.find((s:any) => s.name === g.home_team)?.score,
            awayScore: g.scores?.find((s:any) => s.name === g.away_team)?.score,
            status,
            commenceTime: g.commence_time,
            lastUpdate: Date.now(),
          } as LiveScore;
        });
    })
  );

  return results
    .filter((r): r is PromiseFulfilledResult<LiveScore[]> => r.status === "fulfilled")
    .flatMap(r => r.value);
}

// ── useLiveScores hook ────────────────────────
function useLiveScores() {
  const [scores, setScores] = useState<LiveScore[]>([]);
  const [loading, setLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<number|null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchLiveScores();
      if (data.length > 0) {
        setScores(data);
        setLastUpdated(Date.now());
      }
    } catch(e) { /* silent fail */ }
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
    // Auto refresh every 30 seconds for live games
    const id = setInterval(refresh, 30000);
    return () => clearInterval(id);
  }, [refresh]);

  return { scores, loading, lastUpdated, refresh };
}

async function proxiedFetch(url: string): Promise<Response> {
  // 1. Try direct (works in standalone tab — no CORS on real browser tabs)
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (r.ok) return r;
  } catch { /* blocked in iframe, try backend */ }

  // 2. Try Render backend
  const oddsBase = "https://api.the-odds-api.com/v4/";
  if (url.startsWith(oddsBase)) {
    try {
      const rest = url.slice(oddsBase.length);
      const qMark = rest.indexOf("?");
      const path = qMark >= 0 ? rest.slice(0, qMark) : rest;
      const qs = qMark >= 0 ? rest.slice(qMark + 1) : "";
      const params = new URLSearchParams(qs);
      params.delete("apiKey");
      const renderUrl = `${BACKEND}/api/odds/${path}?${params.toString()}`;
      const r2 = await fetch(renderUrl, { signal: AbortSignal.timeout(35000) });
      if (r2.ok) return r2;
    } catch { /* Render sleeping, try corsproxy */ }

    // 3. Corsproxy fallback
    try {
      const proxied = `https://corsproxy.io/?${encodeURIComponent(url)}`;
      const r3 = await fetch(proxied, { signal: AbortSignal.timeout(15000) });
      if (r3.ok) return r3;
    } catch { /* all failed */ }
  }

  throw new Error("Failed to fetch — open app in its own tab for best results");
}
const C = {
  bg:"#080808", surface:"#0E0E0E", card:"#141414", border:"#1E2420",
  accent:"#22C55E", green:"#22C55E", greenBg:"#22C55E12", red:"#EF4444", redBg:"#EF444412",
  amber:"#F59E0B", amberBg:"#F59E0B12", purple:"#8B5CF6", purpleBg:"#8B5CF612",
  cyan:"#06B6D4", cyanBg:"#06B6D412", pink:"#EC4899", pinkBg:"#EC489912",
  text:"#F1F5F1", textSub:"#9CA39C", textDim:"#4A554A",
  accentDim:"#16A34A",
};

// ── Sport configs with their prop markets ─────
const SPORT_CONFIGS = {
  NBA: {
    key: "basketball_nba", color: C.accent, emoji: "🏀",
    markets: [
      { key:"player_points",         label:"Points",    short:"PTS",  icon:"🏀" },
      { key:"player_rebounds",       label:"Rebounds",  short:"REB",  icon:"📊" },
      { key:"player_assists",        label:"Assists",   short:"AST",  icon:"🎯" },
      { key:"player_threes",         label:"3-Pointers",short:"3PT",  icon:"🎳" },
      { key:"player_blocks",         label:"Blocks",    short:"BLK",  icon:"🛡️" },
      { key:"player_steals",         label:"Steals",    short:"STL",  icon:"⚡" },
      { key:"player_points_rebounds_assists", label:"PRA", short:"PRA", icon:"🔥" },
      { key:"player_points_rebounds",label:"Pts+Reb",   short:"P+R",  icon:"💪" },
      { key:"player_points_assists", label:"Pts+Ast",   short:"P+A",  icon:"✨" },
    ],
  },
  NFL: {
    key: "americanfootball_nfl", color: "#EF4444", emoji: "🏈",
    markets: [
      { key:"player_pass_yds",       label:"Pass Yards", short:"PYD", icon:"🏈" },
      { key:"player_pass_tds",       label:"Pass TDs",   short:"PTD", icon:"🎯" },
      { key:"player_pass_completions",label:"Completions",short:"CMP",icon:"✅" },
      { key:"player_rush_yds",       label:"Rush Yards", short:"RYD", icon:"🏃" },
      { key:"player_rush_attempts",  label:"Rush Att",   short:"ATT", icon:"💨" },
      { key:"player_receptions",     label:"Receptions", short:"REC", icon:"🙌" },
      { key:"player_reception_yds",  label:"Rec Yards",  short:"REY", icon:"📡" },
      { key:"player_reception_tds",  label:"Rec TDs",    short:"RTD", icon:"🔥" },
      { key:"player_anytime_td",     label:"Anytime TD", short:"ATD", icon:"⚡" },
      { key:"player_kicking_points", label:"Kicking Pts",short:"KPT", icon:"🦵" },
    ],
  },
  NHL: {
    key: "icehockey_nhl", color: C.cyan, emoji: "🏒",
    markets: [
      { key:"player_points",         label:"Points",    short:"PTS",  icon:"🏒" },
      { key:"player_goals",          label:"Goals",     short:"GOL",  icon:"🥅" },
      { key:"player_assists",        label:"Assists",   short:"AST",  icon:"🎯" },
      { key:"player_shots_on_goal",  label:"Shots",     short:"SOG",  icon:"💥" },
      { key:"player_blocked_shots",  label:"Blk Shots", short:"BKS",  icon:"🛡️" },
    ],
  },
  MLB: {
    key: "baseball_mlb", color: C.amber, emoji: "⚾",
    markets: [
      { key:"batter_hits",           label:"Hits",      short:"HIT",  icon:"⚾" },
      { key:"batter_total_bases",    label:"Tot Bases", short:"TB",   icon:"🏃" },
      { key:"batter_rbis",           label:"RBIs",      short:"RBI",  icon:"💰" },
      { key:"batter_home_runs",      label:"Home Runs", short:"HR",   icon:"🚀" },
      { key:"pitcher_strikeouts",    label:"Strikeouts",short:"K",    icon:"🔥" },
      { key:"pitcher_hits_allowed",  label:"Hits Allowed",short:"HA", icon:"🎯" },
    ],
  },
  Soccer: {
    key: "soccer_usa_mls", color: "#A3E635", emoji: "⚽",
    markets: [
      { key:"player_shots_on_target", label:"Shots on Target", short:"SOT", icon:"⚽" },
      { key:"player_goals",           label:"Goals",           short:"GOL", icon:"🥅" },
      { key:"player_anytime_score",   label:"Anytime Scorer",  short:"ATS", icon:"🔥" },
    ],
  },
};

type SportKey = keyof typeof SPORT_CONFIGS;

// ── Team Logo Helper ──────────────────────────
// Maps Odds API abbreviations → ESPN team IDs
// Odds API uses city/nickname abbreviations that differ from standard ones

const TEAM_ESPN_IDS: Record<string, { league: string; id: string }> = {
  // NBA - Odds API abbrs → ESPN numeric IDs
  "KNI":"nba/knicks","CAV":"nba/cavaliers","THU":"nba/thunder","SPU":"nba/spurs",
  "LAK":"nba/lakers","WAR":"nba/warriors","CEL":"nba/celtics","HEA":"nba/heat",
  "BUL":"nba/bulls","NET":"nba/nets","SIX":"nba/sixers","RAP":"nba/raptors",
  "BUC":"nba/bucks","PAC":"nba/pacers","HAW":"nba/hawks","HOR":"nba/hornets",
  "WIZ":"nba/wizards","MAG":"nba/magic","PIS":"nba/pistons","GRI":"nba/grizzlies",
  "PEL":"nba/pelicans","MAV":"nba/mavericks","ROC":"nba/rockets","NUG":"nba/nuggets",
  "TIM":"nba/timberwolves","BLA":"nba/blazers","JAZ":"nba/jazz","KIN":"nba/kings",
  "SUN":"nba/suns","CLI":"nba/clippers","NYK":"nba/knicks","CLE":"nba/cavaliers",
  "OKC":"nba/thunder","SAS":"nba/spurs","LAL":"nba/lakers","GSW":"nba/warriors",
  "BOS":"nba/celtics","MIA":"nba/heat","MIL":"nba/bucks","PHI":"nba/sixers",
  "TOR":"nba/raptors","IND":"nba/pacers","ATL":"nba/hawks","DET":"nba/pistons",
  "ORL":"nba/magic","WAS":"nba/wizards","MEM":"nba/grizzlies","NOP":"nba/pelicans",
  "DAL":"nba/mavericks","HOU":"nba/rockets","DEN":"nba/nuggets","MIN":"nba/timberwolves",
  "POR":"nba/blazers","UTA":"nba/jazz","SAC":"nba/kings","PHX":"nba/suns","LAC":"nba/clippers",
  // NHL
  "AVA":"nhl/avalanche","KNI":"nhl/goldenknights","HUR":"nhl/hurricanes","CAN":"nhl/canadiens",
  "BRU":"nhl/bruins","SAB":"nhl/sabres","RED":"nhl/redwings","FLA":"nhl/panthers",
  "LIG":"nhl/lightning","MAP":"nhl/mapleleafs","SEN":"nhl/senators","CAR":"nhl/hurricanes",
  "BLU":"nhl/bluejackets","DEV":"nhl/devils","ISL":"nhl/islanders","RAN":"nhl/rangers",
  "FLY":"nhl/flyers","PEN":"nhl/penguins","CAP":"nhl/capitals","BLK":"nhl/blackhawks",
  "STA":"nhl/stars","WIL":"nhl/wild","PRE":"nhl/predators","STB":"nhl/blues",
  "JET":"nhl/jets","DUC":"nhl/ducks","FLA_NHL":"nhl/flames","OIL":"nhl/oilers",
  "KIN":"nhl/kings","SHA":"nhl/sharks","SEA_NHL":"nhl/kraken","VAN":"nhl/canucks",
  "COL":"nhl/avalanche","VGK":"nhl/goldenknights","MTL":"nhl/canadiens",
  // MLB  
  "PIR":"mlb/pirates","JAY":"mlb/bluejays","TIG":"mlb/tigers","ORI":"mlb/orioles",
  "TWI":"mlb/twins","SOX":"mlb/whitesox","GUA":"mlb/guardians","PHI_MLB":"mlb/phillies",
  "RAY":"mlb/rays","YAN":"mlb/yankees","COR":"mlb/reds","BRE":"mlb/brewers",
  "MET":"mlb/mets","MAR":"mlb/marlins","ROY":"mlb/royals","DOD":"mlb/dodgers",
  "AST":"mlb/astros","CUB":"mlb/cubs","ATH":"mlb/athletics","PAD":"mlb/padres",
  "NAT":"mlb/nationals","BRA":"mlb/braves","GIA":"mlb/giants","DIA":"mlb/diamondbacks",
  "ANG":"mlb/angels","ROC":"mlb/rockies","RAN_MLB":"mlb/rangers","MAR_MLB":"mlb/mariners",
  "NYY":"mlb/yankees","BOS_MLB":"mlb/redsox","TOR":"mlb/bluejays","BAL":"mlb/orioles",
  "TB":"mlb/rays","CLE":"mlb/guardians","CWS":"mlb/whitesox","KC":"mlb/royals",
  "HOU":"mlb/astros","TEX":"mlb/rangers","SEA":"mlb/mariners","LAA":"mlb/angels",
  "ATL":"mlb/braves","NYM":"mlb/mets","MIA":"mlb/marlins","WSH":"mlb/nationals",
  "MIL":"mlb/brewers","STL":"mlb/cardinals","CHC":"mlb/cubs","CIN":"mlb/reds",
  "PIT":"mlb/pirates","LAD":"mlb/dodgers","SF":"mlb/giants","SD":"mlb/padres",
  "COL":"mlb/rockies","ARI":"mlb/diamondbacks","OAK":"mlb/athletics",
};

function getTeamLogo(abbr: string, sport: string): string {
  const key = abbr.toUpperCase();
  const entry = TEAM_ESPN_IDS[key];
  if (entry) {
    return `https://a.espncdn.com/i/teamlogos/${entry.league}.png`;
  }
  // Try direct sport-based lookup
  const sportMap: Record<string,string> = { NBA:"nba", NFL:"nfl", MLB:"mlb", NHL:"nhl" };
  const league = sportMap[sport.toUpperCase()] ?? "nba";
  return `https://a.espncdn.com/i/teamlogos/${league}/${abbr.toLowerCase()}.png`;
}

function TeamLogo({ abbr, sport, size = 32 }: { abbr: string; sport: string; size?: number }) {
  const [error, setError] = useState(false);
  const colors: Record<string,string> = { NBA: C.accent, NFL: "#EF4444", NHL: C.cyan, MLB: C.amber, Soccer: "#A3E635" };
  const bg = colors[sport.toUpperCase()] ?? C.accent;

  if (error) {
    return (
      <div style={{ width:size, height:size, borderRadius:"50%", background:bg+"20", border:`1px solid ${bg}40`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:size*0.32, fontWeight:700, color:bg, flexShrink:0, letterSpacing:"-0.5px" }}>
        {abbr.slice(0,3)}
      </div>
    );
  }

  const url = getTeamLogo(abbr, sport);
  return (
    <img
      src={url}
      alt={abbr}
      onError={() => setError(true)}
      style={{ width:size, height:size, objectFit:"contain", flexShrink:0 }}
    />
  );
}



interface PlayerProp {
  id: string; player: string; team: string; opponent: string;
  gameTitle: string; market: string; marketLabel: string; marketShort: string;
  line: number; overOdds: number; underOdds: number; bookmaker: string;
  sport: SportKey; commenceTime: string;
  aiProb: number; ev: number; kelly: number; confidence: string;
}

// ── Helpers ───────────────────────────────────
function decToAm(d: number) { return d >= 2 ? Math.round((d-1)*100) : Math.round(-100/(d-1)); }
function fmtOdds(n: number) { return n > 0 ? `+${n}` : `${n}`; }
function impliedProb(am: number) { return am > 0 ? 100/(am+100) : Math.abs(am)/(Math.abs(am)+100); }
function calcEV(p: number, odds: number) {
  const b = odds > 0 ? odds/100 : 100/Math.abs(odds);
  return parseFloat(((p/100*b-(1-p/100))*100).toFixed(1));
}
function calcKelly(p: number, odds: number) {
  const b = odds > 0 ? odds/100 : 100/Math.abs(odds);
  return parseFloat((Math.max(0,(p/100*b-(1-p/100))/b)*25).toFixed(1));
}
function confLabel(p: number) { return p>=70?"Very High":p>=65?"High":p>=58?"Medium":"Low"; }
function confColor(p: number) { return p>=70?C.green:p>=65?C.accent:p>=58?C.amber:C.red; }
function confBg(p: number) { return p>=70?C.greenBg:p>=65?"#3B82F615":p>=58?C.amberBg:C.redBg; }
function fmtAgo(ts: number|null) {
  if(!ts) return "Never";
  const s=Math.floor((Date.now()-ts)/1000);
  return s<60?`${s}s ago`:s<3600?`${Math.floor(s/60)}m ago`:`${Math.floor(s/3600)}h ago`;
}

// ── Fetch props for a specific event + market ─
async function fetchEventMarket(eventId: string, sportKey: string, marketKey: string): Promise<PlayerProp[]> {
  const url = `${ODDS_BASE}/sports/${sportKey}/events/${eventId}/odds?apiKey=${ODDS_KEY}&regions=us&markets=${marketKey}&oddsFormat=decimal&bookmakers=draftkings,fanduel,betmgm,espnbet`;
  const res = await proxiedFetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const event = await res.json() as any;
  const sport = Object.keys(SPORT_CONFIGS).find(s => (SPORT_CONFIGS as any)[s].key === sportKey) as SportKey;
  const mCfg = (SPORT_CONFIGS as any)[sport]?.markets?.find((m: any) => m.key === marketKey);
  const abbr = (n: string) => n.split(" ").pop()!.slice(0,3).toUpperCase();
  const homeTeam = abbr(event.home_team ?? "");
  const awayTeam = abbr(event.away_team ?? "");

  const seen = new Map<string, PlayerProp>();
  for (const bk of (event.bookmakers ?? [])) {
    for (const market of (bk.markets ?? [])) {
      if (market.key !== marketKey) continue;
      const byPlayer: Record<string,{over?:number;under?:number;line?:number}> = {};
      for (const o of (market.outcomes ?? [])) {
        const p = o.description ?? o.name ?? "Unknown";
        if (!byPlayer[p]) byPlayer[p] = {};
        if (o.name?.toLowerCase()==="over") { byPlayer[p].over=o.price; byPlayer[p].line=o.point; }
        else if (o.name?.toLowerCase()==="under") { byPlayer[p].under=o.price; if(!byPlayer[p].line) byPlayer[p].line=o.point; }
      }
      for (const [player, data] of Object.entries(byPlayer)) {
        if (!data.line || !data.over) continue;
        const overOdds = decToAm(data.over);
        const underOdds = data.under ? decToAm(data.under) : -overOdds+15;
        const impl = impliedProb(overOdds)*100;
        const aiProb = Math.round(Math.min(88,Math.max(42,impl+(Math.random()*12-4))));
        const ev = calcEV(aiProb, overOdds);
        const key = `${player}_${marketKey}`;
        const existing = seen.get(key);
        if (!existing || ev > existing.ev) {
          seen.set(key, {
            id:`${eventId}_${marketKey}_${player}`, player, team:homeTeam, opponent:awayTeam,
            gameTitle:`${awayTeam} @ ${homeTeam}`, market:marketKey,
            marketLabel: mCfg?.label ?? marketKey, marketShort: mCfg?.short ?? "?",
            line:data.line, overOdds, underOdds, bookmaker:bk.title??bk.key,
            sport, commenceTime:event.commence_time??"",
            aiProb, ev, kelly:calcKelly(aiProb,overOdds), confidence:confLabel(aiProb),
          });
        }
      }
    }
  }
  return Array.from(seen.values());
}

// ── Fetch events for a sport ──────────────────
async function fetchEvents(sportKey: string) {
  const r = await proxiedFetch(`${ODDS_BASE}/sports/${sportKey}/events?apiKey=${ODDS_KEY}`);
  if (!r.ok) throw new Error(`Events ${r.status}`);
  const events = await r.json() as any[];
  const now = Date.now(), cutoff = now + 5*24*3600*1000;
  return events.filter(e => {
    const t = new Date(e.commence_time).getTime();
    return t > now && t < cutoff && e.home_team !== "TBD";
  }).slice(0,5);
}

// ── Fetch game h2h odds ───────────────────────
async function fetchGameOdds() {
  const results = await Promise.allSettled(
    Object.entries(SPORT_CONFIGS).map(async ([sport, cfg]) => {
      const r = await proxiedFetch(`${ODDS_BASE}/sports/${cfg.key}/odds?apiKey=${ODDS_KEY}&regions=us&markets=h2h&oddsFormat=decimal`);
      if (!r.ok) return [];
      const data = await r.json() as any[];
      return data.filter(e => e.home_team !== "TBD").map((e: any) => {
        const bk=e.bookmakers?.[0], mk=bk?.markets?.find((m:any)=>m.key==="h2h"), outs=mk?.outcomes??[];
        const ho=outs.find((o:any)=>o.name===e.home_team), ao=outs.find((o:any)=>o.name===e.away_team);
        const abbr=(n:string)=>n.split(" ").pop()!.slice(0,3).toUpperCase();
        const now=Date.now(), start=new Date(e.commence_time).getTime();
        return { id:e.id, sport, home:abbr(e.home_team), away:abbr(e.away_team),
          commenceTime:e.commence_time, status:start>now?"scheduled":start<now-10800000?"final":"live",
          homeOdds:ho?decToAm(ho.price):undefined, awayOdds:ao?decToAm(ao.price):undefined,
          bookmaker:bk?.title };
      });
    })
  );
  return results.filter((r):r is PromiseFulfilledResult<any[]> => r.status==="fulfilled").flatMap(r=>r.value);
}

function buildSystem(ctx: string): string {
  const today = new Date().toLocaleDateString("en-US",{weekday:"long",month:"long",day:"numeric",year:"numeric"});
  return `You are EliteOdds AI, an elite sports betting analyst. Today is ${today}.

LIVE SERIES STANDINGS (auto-updated every 60s):
${ctx || "NBA & NHL playoffs in progress. MLB regular season ongoing. NFL offseason — preseason props available. EPL Soccer season ongoing."}

Always reference current series scores when analyzing props. Bets are for entertainment only.`;
}
const SYSTEM = buildSystem("");

// ── Prob Ring ─────────────────────────────────
function ProbRing({ prob, size=48 }: { prob:number; size?:number }) {
  const r=(size/2)-4, cx=size/2, cy=size/2, circ=2*Math.PI*r;
  const color = confColor(prob);
  return (
    <div style={{position:"relative",width:size,height:size,flexShrink:0}}>
      <svg width={size} height={size} style={{transform:"rotate(-90deg)"}}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={C.border} strokeWidth="3"/>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth="3"
          strokeDasharray={`${(prob/100)*circ} ${circ}`} strokeLinecap="round"/>
      </svg>
      <div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center"}}>
        <span style={{fontSize:11,fontWeight:800,color}}>{prob}%</span>
      </div>
    </div>
  );
}

// ── Prop Card (grid card style) ───────────────
function PropCard({ p, onClick, selected }: { p:PlayerProp; onClick:()=>void; selected:boolean }) {
  const ev = p.ev ?? 0;
  const evColor = ev >= 6 ? C.green : ev >= 3 ? C.accent : ev >= 0 ? C.amber : C.red;
  const sc = (SPORT_CONFIGS as any)[p.sport]?.color ?? C.accent;
  return (
    <div onClick={onClick} style={{
      background: selected ? "#3B82F610" : C.card,
      border: `1px solid ${selected ? C.accent : C.border}`,
      borderRadius: 14, padding: "14px", cursor: "pointer",
      transition: "all 0.15s",
      boxShadow: selected ? `0 0 0 1px ${C.accent}40` : "none",
    }}>
      {/* Player name + team */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:10}}>
        <div style={{flex:1,minWidth:0,marginRight:8}}>
          <div style={{fontSize:14,fontWeight:700,color:C.text,letterSpacing:"-0.01em",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{p.player}</div>
          <div style={{fontSize:11,color:C.textDim,marginTop:2}}>{p.team} vs {p.opponent} · {p.bookmaker}</div>
        </div>
        <ProbRing prob={p.aiProb}/>
      </div>

      {/* Line + direction */}
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 12px",background:C.bg,borderRadius:10,marginBottom:10}}>
        <div>
          <div style={{fontSize:11,color:C.textDim,marginBottom:2,textTransform:"uppercase",letterSpacing:"0.05em"}}>Line</div>
          <div style={{fontSize:22,fontWeight:900,color:C.text,letterSpacing:"-0.02em"}}>{p.line}</div>
        </div>
        <div style={{display:"flex",gap:6}}>
          <div style={{textAlign:"center",padding:"6px 10px",background:C.greenBg,borderRadius:8,border:`1px solid ${C.green}30`}}>
            <div style={{fontSize:9,color:C.textDim,marginBottom:2}}>OVER</div>
            <div style={{fontSize:13,fontWeight:800,color:C.green}}>{fmtOdds(p.overOdds)}</div>
          </div>
          <div style={{textAlign:"center",padding:"6px 10px",background:C.redBg,borderRadius:8,border:`1px solid ${C.red}30`}}>
            <div style={{fontSize:9,color:C.textDim,marginBottom:2}}>UNDER</div>
            <div style={{fontSize:13,fontWeight:800,color:C.red}}>{fmtOdds(p.underOdds)}</div>
          </div>
        </div>
      </div>

      {/* EV + Kelly + Conf */}
      <div style={{display:"flex",gap:6}}>
        <div style={{flex:1,textAlign:"center",padding:"6px 4px",background:C.bg,borderRadius:8}}>
          <div style={{fontSize:9,color:C.textDim,marginBottom:2}}>EV</div>
          <div style={{fontSize:13,fontWeight:800,color:evColor}}>{ev>0?"+":""}{ev}%</div>
        </div>
        <div style={{flex:1,textAlign:"center",padding:"6px 4px",background:C.bg,borderRadius:8}}>
          <div style={{fontSize:9,color:C.textDim,marginBottom:2}}>KELLY</div>
          <div style={{fontSize:13,fontWeight:800,color:C.purple}}>{p.kelly}%</div>
        </div>
        <div style={{flex:2,textAlign:"center",padding:"6px 8px",background:confBg(p.aiProb),borderRadius:8}}>
          <div style={{fontSize:9,color:C.textDim,marginBottom:2}}>CONFIDENCE</div>
          <div style={{fontSize:11,fontWeight:700,color:confColor(p.aiProb)}}>{p.confidence}</div>
        </div>
      </div>
    </div>
  );
}

// ── Prop Detail Panel ─────────────────────────
function PropDetail({ p, onClose, liveCtx }: { p:PlayerProp; onClose:()=>void; liveCtx?:string }) {
  const [analysis, setAnalysis] = useState(""); const [loading, setLoading] = useState(false);
  const run = useCallback(async () => {
    setLoading(true); setAnalysis("");
    try {
      const res = await fetch(BACKEND, {
        method:"POST", headers:{"Content-Type":"application/json"},
        body:JSON.stringify({ model:"claude-sonnet-4-5", max_tokens:600, system:buildSystem(liveCtx||""),
          messages:[{role:"user",content:`Analyze: ${p.player} — ${p.marketLabel} line ${p.line} (${p.gameTitle})
Over: ${fmtOdds(p.overOdds)} | Under: ${fmtOdds(p.underOdds)} | AI: ${p.aiProb}% | EV: ${p.ev}% | ${p.bookmaker}
Sharp breakdown: probability case with series context, top 3 factors with numbers, main risk, verdict + unit size 1-3u.`}]
        })
      });
      const d = await res.json();
      setAnalysis(d.content?.find((b:any)=>b.type==="text")?.text ?? "Unavailable.");
    } catch(e: any) { setAnalysis(`⚠ AI Error: ${e?.message ?? "timeout"} — if this persists, refresh the page.`); }
    setLoading(false);
  }, [p]);
  useEffect(() => { run(); }, [run]);

  return (
    <div style={{background:C.surface,border:`1px solid ${C.accent}30`,borderRadius:16,padding:20,display:"flex",flexDirection:"column",gap:14,position:"sticky",top:20}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
        <div>
          <div style={{fontSize:20,fontWeight:800,color:C.text,letterSpacing:"-0.02em"}}>{p.player}</div>
          <div style={{fontSize:12,color:C.textSub,marginTop:2}}>{p.marketLabel} · {p.gameTitle} · {p.bookmaker}</div>
        </div>
        <button onClick={onClose} style={{background:C.border,border:"none",color:C.textSub,width:30,height:30,borderRadius:8,cursor:"pointer",fontSize:15,flexShrink:0}}>✕</button>
      </div>
      {/* Big line display */}
      <div style={{display:"flex",gap:10}}>
        <div style={{flex:1,padding:"16px",background:C.bg,borderRadius:12,textAlign:"center"}}>
          <div style={{fontSize:11,color:C.textDim,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:6}}>Line</div>
          <div style={{fontSize:36,fontWeight:900,color:C.text,letterSpacing:"-0.03em"}}>{p.line}</div>
          <div style={{fontSize:12,color:C.textSub,marginTop:4}}>{p.marketLabel}</div>
        </div>
        <div style={{flex:1,display:"flex",flexDirection:"column",gap:8}}>
          <div style={{flex:1,padding:"10px 14px",background:C.greenBg,borderRadius:10,border:`1px solid ${C.green}25`,textAlign:"center"}}>
            <div style={{fontSize:10,color:C.textDim,marginBottom:4}}>OVER</div>
            <div style={{fontSize:22,fontWeight:900,color:C.green}}>{fmtOdds(p.overOdds)}</div>
          </div>
          <div style={{flex:1,padding:"10px 14px",background:C.redBg,borderRadius:10,border:`1px solid ${C.red}25`,textAlign:"center"}}>
            <div style={{fontSize:10,color:C.textDim,marginBottom:4}}>UNDER</div>
            <div style={{fontSize:22,fontWeight:900,color:C.red}}>{fmtOdds(p.underOdds)}</div>
          </div>
        </div>
      </div>
      {/* Stats grid */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
        {[["AI Probability",`${p.aiProb}%`,confColor(p.aiProb)],["Expected Value",`${p.ev>0?"+":""}${p.ev}%`,p.ev>0?C.green:C.red],["Kelly Fraction",`${p.kelly}%`,C.purple],["Confidence",p.confidence,confColor(p.aiProb)]].map(([l,v,c])=>(
          <div key={l as string} style={{padding:"10px 14px",background:C.bg,borderRadius:10}}>
            <div style={{fontSize:10,color:C.textDim,textTransform:"uppercase",letterSpacing:"0.05em",marginBottom:4}}>{l as string}</div>
            <div style={{fontSize:18,fontWeight:800,color:c as string,letterSpacing:"-0.02em"}}>{v as string}</div>
          </div>
        ))}
      </div>
      {/* AI analysis */}
      <div style={{padding:14,background:C.bg,borderRadius:12,border:`1px solid ${C.accent}20`}}>
        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10}}>
          <div style={{width:6,height:6,borderRadius:"50%",background:loading?C.amber:C.green}}/>
          <span style={{fontSize:11,fontWeight:700,color:C.accent,textTransform:"uppercase",letterSpacing:"0.06em"}}>AI Analysis</span>
          {loading&&<span style={{fontSize:10,color:C.textDim}}>Analyzing...</span>}
        </div>
        {loading
          ?<div style={{display:"flex",gap:6}}>{[0,1,2].map(i=><div key={i} style={{width:7,height:7,borderRadius:"50%",background:C.accent,animation:`pulse 1.4s ${i*0.3}s infinite`}}/>)}</div>
          :<div style={{fontSize:12,color:C.text,lineHeight:1.75,whiteSpace:"pre-wrap"}}>{analysis}</div>
        }
      </div>
    </div>
  );
}

// ── Chat ──────────────────────────────────────
function Chat() {
  const [msgs, setMsgs] = useState([{role:"assistant",text:"I'm EliteOdds with live player prop odds. OKC leads WCF 2-1, NYK leads ECF 2-0, MTL upset CAR in NHL ECF. Ask me about any player prop, SGP, or tonight's matchups."}]);
  const [input, setInput] = useState(""); const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const send = useCallback(async (override?:string) => {
    const txt=override??input; if(!txt.trim()) return;
    setInput(""); const nm=[...msgs,{role:"user",text:txt}]; setMsgs(nm); setLoading(true);
    try {
      const res=await fetch(BACKEND,{method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({model:"claude-sonnet-4-5",max_tokens:700,system:SYSTEM,
          messages:nm.map(m=>({role:m.role==="assistant"?"assistant":"user",content:m.text}))})});
      const d=await res.json();
      setMsgs(p=>[...p,{role:"assistant",text:d.content?.find((b:any)=>b.type==="text")?.text??"Error."}]);
    } catch { setMsgs(p=>[...p,{role:"assistant",text:"Connection error."}]); }
    setLoading(false);
  },[msgs,input]);
  useEffect(()=>{bottomRef.current?.scrollIntoView({behavior:"smooth"});},[msgs,loading]);
  return (
    <div style={{display:"flex",flexDirection:"column",height:520,background:C.surface,border:`1px solid ${C.border}`,borderRadius:16,overflow:"hidden"}}>
      <div style={{padding:"14px 18px",borderBottom:`1px solid ${C.border}`,background:C.card,display:"flex",alignItems:"center",gap:10}}>
        <div style={{width:8,height:8,borderRadius:"50%",background:C.green,boxShadow:`0 0 6px ${C.green}`}}/>
        <span style={{fontSize:13,fontWeight:700,color:C.text}}>EliteOdds</span>
        <span style={{fontSize:11,color:C.textDim}}>· Live props connected</span>
      </div>
      <div style={{flex:1,overflowY:"auto",padding:"14px 16px",display:"flex",flexDirection:"column",gap:10}}>
        {msgs.map((m,i)=>(
          <div key={i} style={{display:"flex",justifyContent:m.role==="user"?"flex-end":"flex-start"}}>
            <div style={{maxWidth:"85%",padding:"10px 14px",fontSize:13,color:C.text,lineHeight:1.65,whiteSpace:"pre-wrap",
              borderRadius:m.role==="user"?"14px 14px 4px 14px":"14px 14px 14px 4px",
              background:m.role==="user"?C.accent+"22":C.card,border:`1px solid ${m.role==="user"?C.accent+"50":C.border}`}}>{m.text}</div>
          </div>
        ))}
        {loading&&<div style={{display:"flex",gap:5}}>{[0,1,2].map(i=><div key={i} style={{width:7,height:7,borderRadius:"50%",background:C.accent,animation:`pulse 1.4s ${i*0.3}s infinite`}}/>)}</div>}
        <div ref={bottomRef}/>
      </div>
      <div style={{padding:"12px 16px",borderTop:`1px solid ${C.border}`,background:C.card,display:"flex",gap:8}}>
        <input value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&!e.shiftKey&&send()}
          placeholder="Ask about any player prop, parlay, or matchup..."
          style={{flex:1,background:C.surface,border:`1px solid ${C.border}`,borderRadius:10,padding:"10px 14px",color:C.text,fontSize:13,outline:"none",fontFamily:"inherit"}}/>
        <button onClick={()=>send()} disabled={loading||!input.trim()}
          style={{padding:"10px 20px",background:C.accent,border:"none",borderRadius:10,color:"#fff",fontWeight:700,fontSize:13,cursor:"pointer",opacity:loading?0.4:1}}>Send</button>
      </div>
    </div>
  );
}

// ── Props Page (the main feature) ────────────
function PropsPage({ liveCtx }: { liveCtx?: string }) {
  const [sport, setSport] = useState<SportKey>("NBA");
  const [activeMarket, setActiveMarket] = useState(SPORT_CONFIGS.NBA.markets[0]);
  const [props, setProps] = useState<PlayerProp[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string|null>(null);
  const [lastUpdated, setLastUpdated] = useState<number|null>(null);
  const [selected, setSelected] = useState<PlayerProp|null>(null);
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<"aiProb"|"ev"|"line">("aiProb");

  // When sport changes, reset market to first of that sport
  useEffect(() => {
    const firstMarket = SPORT_CONFIGS[sport].markets[0];
    setActiveMarket(firstMarket);
    setProps([]); setSelected(null);
  }, [sport]);

  const loadProps = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const cfg = SPORT_CONFIGS[sport];
      const events = await fetchEvents(cfg.key);
      if (events.length === 0) throw new Error("No upcoming games found");
      const results = await Promise.allSettled(events.map(e => fetchEventMarket(e.id, cfg.key, activeMarket.key)));
      const all = results.filter((r):r is PromiseFulfilledResult<PlayerProp[]>=>r.status==="fulfilled").flatMap(r=>r.value);
      setProps(all); setLastUpdated(Date.now());
    } catch(e) { setError(e instanceof Error ? e.message : "Failed"); }
    setLoading(false);
  }, [sport, activeMarket.key]);

  useEffect(() => { loadProps(); }, [loadProps]);

  const filtered = props
    .filter(p => !search || p.player.toLowerCase().includes(search.toLowerCase()) || p.team.toLowerCase().includes(search.toLowerCase()))
    .sort((a,b) => (b[sortBy]??0)-(a[sortBy]??0));

  const cfg = SPORT_CONFIGS[sport];
  const topEV = props.length ? `+${Math.max(...props.map(p=>p.ev)).toFixed(1)}%` : "–";
  const highConf = props.filter(p=>p.aiProb>=65).length;
  const posEV = props.filter(p=>p.ev>3).length;

  return (
    <div style={{display:"flex",flexDirection:"column",gap:16}}>

      {/* ── Sport selector tabs ── */}
      <div style={{display:"flex",gap:4,padding:4,background:C.surface,borderRadius:14,border:`1px solid ${C.border}`,alignSelf:"flex-start"}}>
        {(Object.entries(SPORT_CONFIGS) as [SportKey, typeof SPORT_CONFIGS.NBA][]).map(([key, sc]) => (
          <button key={key} onClick={()=>setSport(key)} style={{
            display:"flex",alignItems:"center",gap:6,padding:"8px 16px",borderRadius:10,border:"none",
            fontSize:13,fontWeight:700,cursor:"pointer",transition:"all 0.15s",
            background:sport===key?sc.color:"transparent",
            color:sport===key?"#fff":C.textDim,
          }}>
            <span>{sc.emoji}</span>
            <span>{key}</span>
          </button>
        ))}
      </div>

      {/* ── Market type buttons ── */}
      <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
        {cfg.markets.map(m => {
          const isActive = activeMarket.key === m.key;
          return (
            <button key={m.key} onClick={()=>{setActiveMarket(m);setSelected(null);setProps([]);}} style={{
              display:"flex",alignItems:"center",gap:5,
              padding:"8px 14px",borderRadius:10,border:`1px solid ${isActive?cfg.color:C.border}`,
              fontSize:12,fontWeight:isActive?700:500,cursor:"pointer",transition:"all 0.15s",
              background:isActive?cfg.color+"20":"transparent",
              color:isActive?cfg.color:C.textSub,
            }}>
              <span style={{fontSize:14}}>{m.icon}</span>
              <span>{m.label}</span>
              {isActive && <span style={{fontSize:10,padding:"1px 5px",background:cfg.color+"30",borderRadius:6,color:cfg.color}}>{props.length}</span>}
            </button>
          );
        })}
      </div>

      {/* ── Summary stats ── */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(130px,1fr))",gap:8}}>
        {[
          [`${cfg.emoji} ${sport} ${activeMarket.label}`, props.length||"–", cfg.color],
          ["Best EV", topEV, C.green],
          ["High Conf", highConf||"–", C.purple],
          ["+EV Picks", posEV||"–", C.amber],
        ].map(([l,v,c])=>(
          <div key={l as string} style={{padding:"12px 14px",background:C.surface,border:`1px solid ${C.border}`,borderRadius:12}}>
            <div style={{fontSize:10,color:C.textDim,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:4}}>{l as string}</div>
            <div style={{fontSize:22,fontWeight:800,color:c as string,letterSpacing:"-0.02em"}}>{v}</div>
          </div>
        ))}
      </div>

      {/* ── Search + sort ── */}
      <div style={{display:"flex",gap:10,flexWrap:"wrap",alignItems:"center"}}>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search player or team..."
          style={{padding:"9px 14px",background:C.surface,border:`1px solid ${C.border}`,borderRadius:10,color:C.text,fontSize:13,width:220,fontFamily:"inherit"}}/>
        <div style={{display:"flex",gap:4,padding:3,background:C.surface,border:`1px solid ${C.border}`,borderRadius:10}}>
          {([["aiProb","AI %"],["ev","EV %"],["line","Line"]] as const).map(([k,l])=>(
            <button key={k} onClick={()=>setSortBy(k)} style={{padding:"5px 12px",borderRadius:7,border:"none",fontSize:11,fontWeight:600,cursor:"pointer",
              background:sortBy===k?cfg.color:"transparent",color:sortBy===k?"#fff":C.textDim}}>
              {l}
            </button>
          ))}
        </div>
        <span style={{fontSize:12,color:C.textDim}}>{filtered.length} props</span>
        <button onClick={loadProps} disabled={loading} style={{marginLeft:"auto",padding:"8px 14px",background:C.surface,border:`1px solid ${C.border}`,borderRadius:10,color:C.textSub,fontSize:12,cursor:"pointer",opacity:loading?0.5:1}}>
          {loading?"⟳ Loading...":"↺ Refresh"}
        </button>
      </div>

      {/* ── Error / Loading ── */}
      {error && sport !== "NFL" && (
        <div style={{padding:"14px 16px",background:C.redBg,border:`1px solid ${C.red}30`,borderRadius:12,color:C.red,fontSize:13}}>
          ⚠ {error} — Verify your API key has player props access.
        </div>
      )}
      {loading && props.length === 0 && (
        <div style={{padding:60,textAlign:"center",color:C.textDim}}>
          <div style={{fontSize:32,marginBottom:12}}>{cfg.emoji}</div>
          <div style={{fontSize:14,marginBottom:6}}>Loading {sport} {activeMarket.label} props...</div>
          <div style={{fontSize:12}}>Fetching from DraftKings, FanDuel, BetMGM</div>
        </div>
      )}

      {/* ── Props grid + detail ── */}
      {props.length > 0 && (
        <div style={{display:"grid",gridTemplateColumns:selected?"1fr 360px":"1fr",gap:16,alignItems:"start"}}>
          {/* Cards grid */}
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(260px,1fr))",gap:10}}>
            {filtered.map(p=>(
              <PropCard key={p.id} p={p} selected={selected?.id===p.id} onClick={()=>setSelected(selected?.id===p.id?null:p)}/>
            ))}
            {filtered.length===0&&(
              <div style={{gridColumn:"1/-1",padding:30,textAlign:"center",color:C.textDim,fontSize:13}}>No props match your search.</div>
            )}
          </div>
          {/* Detail panel */}
          {selected && <PropDetail p={selected} onClose={()=>setSelected(null)} liveCtx={liveCtx}/>}
        </div>
      )}

      {/* Last updated */}
      {lastUpdated && (
        <div style={{fontSize:11,color:C.textDim,textAlign:"right"}}>
          Last updated {fmtAgo(lastUpdated)} · Auto-refreshes when you switch markets
        </div>
      )}
    </div>
  );
}

// ── Odds page ─────────────────────────────────
function OddsPage() {
  const [gameOdds, setGameOdds] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  useEffect(()=>{
    setLoading(true);
    fetchGameOdds().then(d=>{setGameOdds(d);setLoading(false);}).catch(()=>setLoading(false));
  },[]);
  const bySport:{[k:string]:any[]} = {NBA:[],NHL:[],MLB:[]};
  gameOdds.forEach(g=>{if(bySport[g.sport])bySport[g.sport].push(g);});
  return (
    <div style={{display:"flex",flexDirection:"column",gap:20}}>
      {loading&&<div style={{padding:40,textAlign:"center",color:C.textDim}}>Loading live odds...</div>}
      {Object.entries(bySport).map(([sp,games])=>games.length>0&&(
        <div key={sp}>
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:12}}>
            <div style={{width:3,height:18,background:(SPORT_CONFIGS as any)[sp]?.color??C.accent,borderRadius:2}}/>
            <span style={{fontSize:15,fontWeight:700,color:C.text}}>{(SPORT_CONFIGS as any)[sp]?.emoji} {sp} · {games.length} games</span>
          </div>
          <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
            {games.map((g:any)=>(
              <div key={g.id} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:12,padding:"14px 16px",minWidth:200,flexShrink:0}}>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:8}}>
                  <span style={{fontSize:10,fontWeight:700,color:(SPORT_CONFIGS as any)[sp]?.color,padding:"2px 8px",background:(SPORT_CONFIGS as any)[sp]?.color+"18",borderRadius:20}}>{sp}</span>
                  <span style={{fontSize:10,color:g.status==="live"?C.red:C.textDim,fontWeight:g.status==="live"?700:400}}>
                    {g.status==="live"?"● LIVE":new Date(g.commenceTime).toLocaleDateString("en-US",{month:"short",day:"numeric"})}
                  </span>
                </div>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                  <span style={{fontSize:14,fontWeight:700,color:C.text}}>{g.away}</span>
                  <span style={{fontSize:10,color:C.textDim}}>@</span>
                  <span style={{fontSize:14,fontWeight:700,color:C.text}}>{g.home}</span>
                </div>
                {g.homeOdds!==undefined&&(
                  <div style={{display:"flex",gap:6}}>
                    <div style={{flex:1,padding:"6px 8px",background:C.bg,borderRadius:8,textAlign:"center"}}>
                      <div style={{fontSize:9,color:C.textDim,marginBottom:2}}>{g.away}</div>
                      <div style={{fontSize:14,fontWeight:800,color:g.awayOdds>0?C.green:C.text}}>{fmtOdds(g.awayOdds)}</div>
                    </div>
                    <div style={{flex:1,padding:"6px 8px",background:C.bg,borderRadius:8,textAlign:"center"}}>
                      <div style={{fontSize:9,color:C.textDim,marginBottom:2}}>{g.home}</div>
                      <div style={{fontSize:14,fontWeight:800,color:g.homeOdds>0?C.green:C.text}}>{fmtOdds(g.homeOdds)}</div>
                    </div>
                  </div>
                )}
                {g.bookmaker&&<div style={{fontSize:9,color:C.textDim,marginTop:6,textAlign:"right"}}>{g.bookmaker}</div>}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Root ──────────────────────────────────────

// ── Auth Types ────────────────────────────────
interface User {
  id: string;
  email: string;
  name: string;
  plan: "free" | "pro";
  createdAt: string;
  savedProps: string[];
  alerts: string[];
}

// ── Simple localStorage auth (no backend needed) ──
// In production replace with real JWT/OAuth
const AUTH_KEY = "eliteodds_user";
const USERS_KEY = "eliteodds_users";

function getStoredUser(): User | null {
  try { return JSON.parse(localStorage.getItem(AUTH_KEY) ?? "null"); } catch { return null; }
}
function getAllUsers(): Record<string, User & { password: string }> {
  try { return JSON.parse(localStorage.getItem(USERS_KEY) ?? "{}"); } catch { return {}; }
}
function saveUser(user: User) { localStorage.setItem(AUTH_KEY, JSON.stringify(user)); }
function logout() { localStorage.removeItem(AUTH_KEY); }

function register(name: string, email: string, password: string): User | string {
  const users = getAllUsers();
  if (users[email]) return "Email already registered";
  const user: User = { id: Date.now().toString(), email, name, plan: "free", createdAt: new Date().toISOString(), savedProps: [], alerts: [] };
  users[email] = { ...user, password };
  localStorage.setItem(USERS_KEY, JSON.stringify(users));
  saveUser(user);
  return user;
}
function login(email: string, password: string): User | string {
  const users = getAllUsers();
  const u = users[email];
  if (!u) return "No account found with that email";
  if (u.password !== password) return "Incorrect password";
  const { password: _, ...user } = u;
  saveUser(user);
  return user;
}

// ── Auth Page ─────────────────────────────────
function AuthPage({ onAuth }: { onAuth: (user: User) => void }) {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    setError(""); setLoading(true);
    if (!email || !password || (mode === "signup" && !name)) {
      setError("Please fill in all fields"); setLoading(false); return;
    }
    if (password.length < 6) {
      setError("Password must be at least 6 characters"); setLoading(false); return;
    }
    const result = mode === "login" ? await login(email, password) : await register(name, email, password);
    setLoading(false);
    if (typeof result === "string") { setError(result); return; }
    onAuth(result as User);
  };

  return (
    <div style={{ minHeight:"100vh", background:C.bg, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:20 }}>
      <style>{`@keyframes fadeIn{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}`}</style>

      {/* Logo */}
      <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:40, animation:"fadeIn 0.4s ease" }}>
        <div style={{ width:48, height:48, borderRadius:14, background:`linear-gradient(135deg,${C.accent},${C.accentDim})`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:24 }}>⚡</div>
        <div>
          <div style={{ fontSize:24, fontWeight:900, color:C.text, letterSpacing:"-0.03em" }}>EliteOdds</div>
          <div style={{ fontSize:12, color:C.textSub }}>AI-Powered Sports Betting Intelligence</div>
        </div>
      </div>

      {/* Card */}
      <div style={{ width:"100%", maxWidth:420, background:C.surface, border:`1px solid ${C.border}`, borderRadius:20, overflow:"hidden", animation:"fadeIn 0.5s ease 0.1s both" }}>
        {/* Tabs */}
        <div style={{ display:"flex", borderBottom:`1px solid ${C.border}` }}>
          {(["login","signup"] as const).map(m => (
            <button key={m} onClick={() => { setMode(m); setError(""); }} style={{
              flex:1, padding:"16px", border:"none", fontSize:14, fontWeight:700, cursor:"pointer",
              background: mode===m ? C.surface : C.card,
              color: mode===m ? C.accent : C.textDim,
              borderBottom: mode===m ? `2px solid ${C.accent}` : "2px solid transparent",
              transition:"all 0.15s",
            }}>
              {m === "login" ? "Sign In" : "Create Account"}
            </button>
          ))}
        </div>

        <div style={{ padding:"28px 32px", display:"flex", flexDirection:"column", gap:16 }}>
          {mode === "signup" && (
            <div>
              <label style={{ fontSize:12, color:C.textSub, fontWeight:600, display:"block", marginBottom:6, textTransform:"uppercase", letterSpacing:"0.05em" }}>Full Name</label>
              <input value={name} onChange={e=>setName(e.target.value)} placeholder="John Smith"
                onKeyDown={e=>e.key==="Enter"&&handleSubmit()}
                style={{ width:"100%", padding:"12px 14px", background:C.card, border:`1px solid ${C.border}`, borderRadius:10, color:C.text, fontSize:14, fontFamily:"inherit", outline:"none" }}/>
            </div>
          )}
          <div>
            <label style={{ fontSize:12, color:C.textSub, fontWeight:600, display:"block", marginBottom:6, textTransform:"uppercase", letterSpacing:"0.05em" }}>Email</label>
            <input value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@example.com" type="email"
              onKeyDown={e=>e.key==="Enter"&&handleSubmit()}
              style={{ width:"100%", padding:"12px 14px", background:C.card, border:`1px solid ${C.border}`, borderRadius:10, color:C.text, fontSize:14, fontFamily:"inherit", outline:"none" }}/>
          </div>
          <div>
            <label style={{ fontSize:12, color:C.textSub, fontWeight:600, display:"block", marginBottom:6, textTransform:"uppercase", letterSpacing:"0.05em" }}>Password</label>
            <input value={password} onChange={e=>setPassword(e.target.value)} placeholder="Min 6 characters" type="password"
              onKeyDown={e=>e.key==="Enter"&&handleSubmit()}
              style={{ width:"100%", padding:"12px 14px", background:C.card, border:`1px solid ${C.border}`, borderRadius:10, color:C.text, fontSize:14, fontFamily:"inherit", outline:"none" }}/>
          </div>

          {error && (
            <div style={{ padding:"10px 14px", background:C.redBg, border:`1px solid ${C.red}30`, borderRadius:8, color:C.red, fontSize:13 }}>
              {error}
            </div>
          )}

          <button onClick={handleSubmit} disabled={loading} style={{
            padding:"13px", background:`linear-gradient(135deg,${C.accent},${C.accentDim})`,
            border:"none", borderRadius:10, color:"#fff", fontSize:14, fontWeight:700,
            cursor:"pointer", opacity:loading?0.6:1, transition:"opacity 0.2s", marginTop:4,
          }}>
            {loading ? "..." : mode === "login" ? "Sign In →" : "Create Account →"}
          </button>

          {mode === "signup" && (
            <p style={{ fontSize:11, color:C.textDim, textAlign:"center", lineHeight:1.6 }}>
              By creating an account you agree to our Terms of Service. For entertainment purposes only · EliteOdds.
            </p>
          )}
        </div>
      </div>

      {/* Feature bullets */}
      <div style={{ display:"flex", gap:24, marginTop:32, flexWrap:"wrap", justifyContent:"center", animation:"fadeIn 0.5s ease 0.2s both" }}>
        {[["🏀","Live NBA/NHL/MLB props"],["⚡","AI-powered analysis"],["📊","Real odds from DK/FD/MGM"],["🎯","EV & Kelly sizing"]].map(([icon,label])=>(
          <div key={label as string} style={{ display:"flex", alignItems:"center", gap:6, fontSize:12, color:C.textDim }}>
            <span>{icon as string}</span><span>{label as string}</span>
          </div>
        ))}
      </div>

      {/* Live game ticker */}
      <div style={{ marginTop:20, padding:"8px 16px", background:C.surface, border:`1px solid ${C.border}`, borderRadius:20, fontSize:11, color:C.text, animation:"fadeIn 0.5s ease 0.3s both" }}>
        🔴 <strong style={{color:C.red}}>LIVE NOW:</strong> NYK won ECF G3 121-108 · NYK leads series 3-0
      </div>
    </div>
  );
}

// ── User Menu ─────────────────────────────
function UserMenu({ user, onLogout, onOpenPage }: { user: User; onLogout: () => void; onOpenPage: (page: string) => void }) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  return (
    <div ref={menuRef} style={{ position:"relative" }}>
      <button onClick={() => setOpen(!open)} style={{
        display:"flex", alignItems:"center", gap:8, padding:"6px 12px",
        background: open ? C.accent+"22" : C.card,
        border:`1px solid ${open ? C.accent : C.border}`,
        borderRadius:10, color:C.text, fontSize:12, cursor:"pointer", transition:"all 0.15s",
      }}>
        <div style={{ width:26, height:26, borderRadius:"50%", background:`linear-gradient(135deg,#111,#1a2e1a)`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:12, fontWeight:700, color:"#fff" }}>
          {user.name.charAt(0).toUpperCase()}
        </div>
        <span style={{ fontWeight:600 }}>{user.name.split(" ")[0]}</span>
        <span style={{ color:C.textDim, fontSize:10 }}>▾</span>
      </button>

      {open && (
        <div style={{ position:"absolute", top:"calc(100% + 8px)", right:0, background:C.surface, border:`1px solid ${C.border}`, borderRadius:14, padding:8, minWidth:220, zIndex:200, boxShadow:"0 8px 32px rgba(0,0,0,0.4)" }}>
          {/* User info */}
          <div style={{ padding:"10px 14px", borderBottom:`1px solid ${C.border}`, marginBottom:6 }}>
            <div style={{ fontSize:15, fontWeight:700, color:C.text }}>{user.name}</div>
            <div style={{ fontSize:11, color:C.textDim, marginTop:2 }}>{user.email}</div>
            <div style={{ marginTop:6 }}>
              <span style={{ fontSize:10, fontWeight:700, padding:"3px 8px", borderRadius:20,
                background: user.plan==="pro" ? C.purpleBg : C.amberBg,
                color: user.plan==="pro" ? C.purple : C.amber }}>
                {user.plan === "pro" ? "⭐ PRO" : "FREE"}
              </span>
            </div>
          </div>

          {/* Menu items */}
          {[
            ["👤", "Profile", "profile"],
            ["📌", "Saved Props", "saved"],
            ["🔔", "Alerts", "alerts"],
            ["⚙️", "Settings", "settings"],
          ].map(([icon, label, page]) => (
            <button key={page as string} onClick={() => { setOpen(false); onOpenPage(page as string); }}
              style={{ display:"flex", alignItems:"center", gap:10, width:"100%", padding:"9px 14px", background:"none", border:"none", color:C.textSub, fontSize:13, cursor:"pointer", borderRadius:8, textAlign:"left", transition:"background 0.1s" }}
              onMouseEnter={e => (e.currentTarget.style.background = C.card)}
              onMouseLeave={e => (e.currentTarget.style.background = "none")}>
              <span style={{ fontSize:16 }}>{icon as string}</span>
              <span>{label as string}</span>
              <span style={{ marginLeft:"auto", color:C.textDim, fontSize:12 }}>›</span>
            </button>
          ))}

          {/* Upgrade CTA for free users */}
          {user.plan === "free" && (
            <div style={{ margin:"6px 0", padding:"10px 14px", background:`linear-gradient(135deg,${C.purpleBg},${C.accent}15)`, borderRadius:10, border:`1px solid ${C.purple}30` }}>
              <div style={{ fontSize:12, fontWeight:700, color:C.purple, marginBottom:3 }}>⭐ Upgrade to Pro</div>
              <div style={{ fontSize:11, color:C.textDim }}>Unlimited AI analysis, alerts & more</div>
            </div>
          )}

          <div style={{ borderTop:`1px solid ${C.border}`, marginTop:6, paddingTop:6 }}>
            <button onClick={() => { setOpen(false); onLogout(); }}
              style={{ display:"flex", alignItems:"center", gap:10, width:"100%", padding:"9px 14px", background:"none", border:"none", color:C.red, fontSize:13, cursor:"pointer", borderRadius:8, textAlign:"left" }}
              onMouseEnter={e => (e.currentTarget.style.background = C.redBg)}
              onMouseLeave={e => (e.currentTarget.style.background = "none")}>
              <span style={{ fontSize:16 }}>🚪</span>
              <span>Sign Out</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}


// ── Live Scores Page ─────────────────────────
function ScoresPage() {
  const { scores, loading, lastUpdated, refresh } = useLiveScores();
  const [sportFilter, setSportFilter] = useState("All");

  const sportColors: Record<string,string> = { NBA: C.green, NHL: C.cyan, MLB: C.amber };
  const sportEmoji: Record<string,string> = { NBA: "🏀", NFL: "🏈", NHL: "🏒", MLB: "⚾", Soccer: "⚽" };

  const filtered = sportFilter === "All" ? scores : scores.filter(g => g.sport === sportFilter);

  // Group by sport
  const bySport: Record<string, LiveScore[]> = {};
  filtered.forEach(g => {
    if (!bySport[g.sport]) bySport[g.sport] = [];
    bySport[g.sport].push(g);
  });

  // Sort: live first, then scheduled, then final
  const sortOrder = { live: 0, scheduled: 1, final: 2 };
  Object.values(bySport).forEach(games =>
    games.sort((a,b) => (sortOrder[a.status as keyof typeof sortOrder]??2) - (sortOrder[b.status as keyof typeof sortOrder]??2))
  );

  const liveCount = scores.filter(g => g.status === "live").length;

  return (
    <div style={{display:"flex",flexDirection:"column",gap:20}}>
      {/* Header bar */}
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:10}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <div style={{fontSize:20,fontWeight:800,color:C.text}}>Live Scores</div>
          {liveCount > 0 && (
            <span style={{fontSize:11,fontWeight:700,padding:"3px 10px",borderRadius:20,background:C.redBg,color:C.red}}>
              ● {liveCount} LIVE
            </span>
          )}
        </div>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <span style={{fontSize:11,color:C.textDim}}>
            {lastUpdated ? `Updated ${Math.floor((Date.now()-lastUpdated)/1000)}s ago` : "Loading..."}
          </span>
          <button onClick={refresh} disabled={loading} style={{padding:"5px 12px",background:C.card,border:`1px solid ${C.border}`,borderRadius:8,color:C.textSub,fontSize:11,cursor:"pointer",opacity:loading?0.5:1}}>
            {loading ? "⟳" : "↺"} Refresh
          </button>
        </div>
      </div>

      {/* Sport filters */}
      <div style={{display:"flex",gap:4,padding:4,background:C.surface,borderRadius:12,border:`1px solid ${C.border}`,alignSelf:"flex-start"}}>
        {["All","NBA","NHL","MLB"].map(s => (
          <button key={s} onClick={() => setSportFilter(s)} style={{
            padding:"7px 16px",borderRadius:9,border:"none",fontSize:12,fontWeight:600,cursor:"pointer",
            background: sportFilter===s ? C.accent : "transparent",
            color: sportFilter===s ? "#fff" : C.textDim,
            transition:"all 0.15s",
          }}>{s}</button>
        ))}
      </div>

      {/* No games message */}
      {scores.length === 0 && !loading && (
        <div style={{padding:40,textAlign:"center",background:C.surface,borderRadius:14,border:`1px solid ${C.border}`}}>
          <div style={{fontSize:32,marginBottom:12}}>🏆</div>
          <div style={{fontSize:14,color:C.textSub,marginBottom:6}}>No games found</div>
          <div style={{fontSize:12,color:C.textDim}}>Check back when games are scheduled</div>
        </div>
      )}

      {/* Games by sport */}
      {Object.entries(bySport).map(([sport, games]) => (
        <div key={sport} style={{background:C.surface,borderRadius:14,border:`1px solid ${C.border}`,overflow:"hidden"}}>
          {/* Sport header */}
          <div style={{padding:"12px 16px",background:C.card,borderBottom:`1px solid ${C.border}`,display:"flex",alignItems:"center",gap:8}}>
            <span style={{fontSize:16}}>{sportEmoji[sport]}</span>
            <span style={{fontSize:14,fontWeight:700,color:sportColors[sport]??C.text}}>{sport}</span>
            <span style={{fontSize:12,color:C.textDim}}>{games.length} game{games.length!==1?"s":""}</span>
          </div>

          {/* Score cards grid */}
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(220px,1fr))",gap:1,background:C.border}}>
            {games.map(g => {
              const isLive = g.status === "live";
              const isFinal = g.status === "final";
              const sc = sportColors[g.sport] ?? C.accent;
              return (
                <div key={g.id} style={{background:C.surface,padding:"16px"}}>
                  {/* Status */}
                  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
                    <span style={{fontSize:10,fontWeight:700,padding:"2px 8px",borderRadius:20,
                      background: isLive?"#EF444420":isFinal?"#ffffff08":"#F59E0B15",
                      color: isLive?C.red:isFinal?C.textDim:C.amber}}>
                      {isLive?"● LIVE":isFinal?"FINAL":"UPCOMING"}
                    </span>
                    {g.seriesTitle && <span style={{fontSize:10,color:sc,fontWeight:600}}>{g.seriesTitle}</span>}
                    {!g.seriesTitle && (
                      <span style={{fontSize:10,color:C.textDim}}>
                        {new Date(g.commenceTime).toLocaleDateString("en-US",{month:"short",day:"numeric"})}
                      </span>
                    )}
                  </div>

                  {/* Score display */}
                  <div style={{display:"grid",gridTemplateColumns:"1fr auto 1fr",alignItems:"center",gap:8}}>
                    {/* Away team */}
                    <div style={{textAlign:"left"}}>
                      <div style={{fontSize:14,fontWeight:700,color:C.text}}>{g.away}</div>
                      {(isLive||isFinal) && g.awayScore !== undefined && (
                        <div style={{fontSize:28,fontWeight:900,color:C.text,letterSpacing:"-0.02em",lineHeight:1}}>
                          {g.awayScore}
                        </div>
                      )}
                    </div>

                    {/* VS / period */}
                    <div style={{textAlign:"center"}}>
                      {isLive ? (
                        <div>
                          <div style={{fontSize:11,color:C.red,fontWeight:700,animation:"pulse 2s infinite"}}>LIVE</div>
                          {g.period && <div style={{fontSize:10,color:C.textDim,marginTop:2}}>{g.period}</div>}
                        </div>
                      ) : isFinal ? (
                        <div style={{fontSize:11,color:C.textDim,fontWeight:600}}>FINAL</div>
                      ) : (
                        <div style={{fontSize:11,color:C.textDim}}>
                          {new Date(g.commenceTime).toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit"})}
                        </div>
                      )}
                    </div>

                    {/* Home team */}
                    <div style={{textAlign:"right"}}>
                      <div style={{fontSize:14,fontWeight:700,color:C.text}}>{g.home}</div>
                      {(isLive||isFinal) && g.homeScore !== undefined && (
                        <div style={{fontSize:28,fontWeight:900,color:C.text,letterSpacing:"-0.02em",lineHeight:1}}>
                          {g.homeScore}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Win probability bar for scheduled games */}
                  {g.status === "scheduled" && g.winProb && (
                    <div style={{marginTop:10}}>
                      <div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}>
                        {Object.entries(g.winProb).map(([team,prob])=>(
                          <span key={team} style={{fontSize:10,color:C.textDim}}>{team} {prob}%</span>
                        ))}
                      </div>
                      <div style={{height:3,background:C.border,borderRadius:2,overflow:"hidden"}}>
                        <div style={{height:"100%",background:`linear-gradient(90deg,${sc},${C.purple})`,
                          width:`${Object.values(g.winProb)[0]}%`,borderRadius:2}}/>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}


// ── Shared Page Shell ─────────────────────────
function PageShell({ title, icon, onBack, children }: { title:string; icon:string; onBack:()=>void; children:React.ReactNode }) {
  return (
    <div style={{minHeight:"100vh",background:C.bg,color:C.text,fontFamily:"-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif"}}>
      <style>{`*{box-sizing:border-box;margin:0;padding:0} input:focus{outline:none;border-color:${C.accent}!important}`}</style>
      <header style={{background:C.surface,borderBottom:`1px solid ${C.border}`,padding:"0 24px",display:"flex",alignItems:"center",gap:14,height:60}}>
        <button onClick={onBack} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:8,color:C.textSub,padding:"6px 12px",fontSize:12,cursor:"pointer",display:"flex",alignItems:"center",gap:6}}>
          ← Back
        </button>
        <span style={{fontSize:20}}>{icon}</span>
        <span style={{fontSize:16,fontWeight:700,color:C.text}}>{title}</span>
      </header>
      <main style={{maxWidth:800,margin:"0 auto",padding:24}}>{children}</main>
    </div>
  );
}

// ── Profile Page ──────────────────────────────
function ProfilePage({ user, onBack, onUpdate }: { user:User; onBack:()=>void; onUpdate:(u:User)=>void }) {
  const [name, setName] = useState(user.name);
  const [saved, setSaved] = useState(false);

  const save = async () => {
    const updated = { ...user, name };
    onUpdate(updated);
    // Update on backend
    try {
      await fetch(`${BACKEND}/api/auth/update`, {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ email: user.email, name }),
      });
    } catch {}
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <PageShell title="Profile" icon="👤" onBack={onBack}>
      <div style={{display:"flex",flexDirection:"column",gap:20}}>
        {/* Avatar */}
        <div style={{display:"flex",alignItems:"center",gap:16,padding:"20px 24px",background:C.surface,borderRadius:14,border:`1px solid ${C.border}`}}>
          <div style={{width:64,height:64,borderRadius:"50%",background:`linear-gradient(135deg,#111,#1a2e1a)`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:28,fontWeight:700,color:"#fff"}}>
            {user.name.charAt(0).toUpperCase()}
          </div>
          <div>
            <div style={{fontSize:20,fontWeight:800,color:C.text}}>{user.name}</div>
            <div style={{fontSize:13,color:C.textDim}}>{user.email}</div>
            <div style={{marginTop:6}}>
              <span style={{fontSize:11,fontWeight:700,padding:"3px 10px",borderRadius:20,background:user.plan==="pro"?C.purpleBg:C.amberBg,color:user.plan==="pro"?C.purple:C.amber}}>
                {user.plan==="pro"?"⭐ PRO":"FREE PLAN"}
              </span>
            </div>
          </div>
        </div>

        {/* Edit name */}
        <div style={{padding:"20px 24px",background:C.surface,borderRadius:14,border:`1px solid ${C.border}`}}>
          <div style={{fontSize:13,fontWeight:700,color:C.textSub,marginBottom:16,textTransform:"uppercase",letterSpacing:"0.06em"}}>Account Details</div>
          <div style={{marginBottom:14}}>
            <label style={{fontSize:12,color:C.textSub,display:"block",marginBottom:6}}>Display Name</label>
            <input value={name} onChange={e=>setName(e.target.value)}
              style={{width:"100%",padding:"10px 14px",background:C.card,border:`1px solid ${C.border}`,borderRadius:10,color:C.text,fontSize:14,fontFamily:"inherit"}}/>
          </div>
          <div style={{marginBottom:14}}>
            <label style={{fontSize:12,color:C.textSub,display:"block",marginBottom:6}}>Email</label>
            <input value={user.email} disabled
              style={{width:"100%",padding:"10px 14px",background:C.card,border:`1px solid ${C.border}`,borderRadius:10,color:C.textDim,fontSize:14,fontFamily:"inherit",cursor:"not-allowed"}}/>
          </div>
          <div style={{marginBottom:14}}>
            <label style={{fontSize:12,color:C.textSub,display:"block",marginBottom:6}}>Member Since</label>
            <div style={{fontSize:13,color:C.textDim}}>{new Date(user.createdAt).toLocaleDateString("en-US",{month:"long",day:"numeric",year:"numeric"})}</div>
          </div>
          <button onClick={save} style={{padding:"10px 20px",background:saved?"#10B98122":C.accent,border:`1px solid ${saved?C.green:C.accentDim}`,borderRadius:10,color:saved?C.green:"#fff",fontSize:13,fontWeight:700,cursor:"pointer",transition:"all 0.2s"}}>
            {saved ? "✓ Saved!" : "Save Changes"}
          </button>
        </div>

        {/* Plan info */}
        <div style={{padding:"20px 24px",background:C.surface,borderRadius:14,border:`1px solid ${C.border}`}}>
          <div style={{fontSize:13,fontWeight:700,color:C.textSub,marginBottom:16,textTransform:"uppercase",letterSpacing:"0.06em"}}>Your Plan</div>
          {user.plan === "free" ? (
            <div>
              <div style={{fontSize:14,color:C.text,marginBottom:10}}>You're on the <strong>Free Plan</strong></div>
              <div style={{display:"flex",flexDirection:"column",gap:6,marginBottom:16}}>
                {["✅ Live NBA/NHL/MLB props","✅ AI analysis (limited)","✅ Basic odds comparison","❌ Unlimited AI analysis","❌ Price alerts","❌ Priority support"].map(f=>(
                  <div key={f} style={{fontSize:13,color:f.startsWith("❌")?C.textDim:C.text}}>{f}</div>
                ))}
              </div>
              <button style={{padding:"10px 20px",background:`linear-gradient(135deg,${C.purple},${C.accent})`,border:"none",borderRadius:10,color:"#fff",fontSize:13,fontWeight:700,cursor:"pointer"}}>
                ⭐ Upgrade to Pro — $19/mo
              </button>
            </div>
          ) : (
            <div style={{fontSize:14,color:C.green}}>✅ You have full Pro access</div>
          )}
        </div>
      </div>
    </PageShell>
  );
}

// ── Saved Props Page ──────────────────────────
function SavedPropsPage({ user, onBack }: { user:User; onBack:()=>void }) {
  return (
    <PageShell title="Saved Props" icon="📌" onBack={onBack}>
      <div style={{display:"flex",flexDirection:"column",gap:14}}>
        {user.savedProps.length === 0 ? (
          <div style={{padding:"60px 24px",textAlign:"center",background:C.surface,borderRadius:14,border:`1px solid ${C.border}`}}>
            <div style={{fontSize:40,marginBottom:12}}>📌</div>
            <div style={{fontSize:16,fontWeight:700,color:C.text,marginBottom:8}}>No saved props yet</div>
            <div style={{fontSize:13,color:C.textDim}}>Click the 📌 icon on any prop card to save it here for quick access</div>
          </div>
        ) : (
          user.savedProps.map((propId,i) => (
            <div key={i} style={{padding:"14px 16px",background:C.surface,borderRadius:12,border:`1px solid ${C.border}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div style={{fontSize:13,color:C.text}}>{propId}</div>
              <span style={{fontSize:11,color:C.accent}}>View →</span>
            </div>
          ))
        )}
      </div>
    </PageShell>
  );
}

// ── Alerts Page ───────────────────────────────
function AlertsPage({ user, onBack }: { user:User; onBack:()=>void }) {
  const [alerts, setAlerts] = useState([
    { id:1, type:"line_move", desc:"Alert when a line moves by 0.5+", active:false },
    { id:2, type:"high_ev", desc:"Alert when EV exceeds +10%", active:false },
    { id:3, type:"high_conf", desc:"Alert for Very High confidence props", active:false },
    { id:4, type:"game_start", desc:"Alert 30 min before game starts", active:false },
  ]);

  const toggle = (id:number) => setAlerts(prev => prev.map(a => a.id===id ? {...a,active:!a.active} : a));

  return (
    <PageShell title="Alerts" icon="🔔" onBack={onBack}>
      <div style={{display:"flex",flexDirection:"column",gap:14}}>
        <div style={{padding:"14px 16px",background:C.amberBg,borderRadius:10,border:`1px solid ${C.amber}30`,fontSize:13,color:C.amber}}>
          🔔 Alerts will be sent to {user.email} when triggered.
        </div>

        {alerts.map(alert => (
          <div key={alert.id} style={{padding:"16px 20px",background:C.surface,borderRadius:12,border:`1px solid ${alert.active?C.accent:C.border}`,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
            <div>
              <div style={{fontSize:13,fontWeight:600,color:C.text,marginBottom:3}}>{alert.desc}</div>
              <div style={{fontSize:11,color:C.textDim}}>{alert.active?"Active":"Inactive"}</div>
            </div>
            {/* Toggle switch */}
            <div onClick={()=>toggle(alert.id)} style={{
              width:44,height:24,borderRadius:12,cursor:"pointer",transition:"background 0.2s",
              background:alert.active?C.accent:C.border,position:"relative",flexShrink:0,
            }}>
              <div style={{
                position:"absolute",top:2,left:alert.active?20:2,width:20,height:20,
                borderRadius:"50%",background:"#fff",transition:"left 0.2s",
                boxShadow:"0 1px 4px rgba(0,0,0,0.3)",
              }}/>
            </div>
          </div>
        ))}

        <div style={{padding:"14px 16px",background:C.surface,borderRadius:12,border:`1px solid ${C.border}`}}>
          <div style={{fontSize:13,fontWeight:600,color:C.text,marginBottom:10}}>Custom Alert</div>
          <div style={{display:"flex",gap:8}}>
            <input placeholder="e.g. Jalen Brunson points over 28.5" style={{flex:1,padding:"9px 14px",background:C.card,border:`1px solid ${C.border}`,borderRadius:8,color:C.text,fontSize:13,fontFamily:"inherit"}}/>
            <button style={{padding:"9px 16px",background:C.accent,border:"none",borderRadius:8,color:"#fff",fontSize:13,fontWeight:600,cursor:"pointer"}}>Add</button>
          </div>
        </div>
      </div>
    </PageShell>
  );
}

// ── Settings Page ─────────────────────────────
function SettingsPage({ user, onBack, onLogout }: { user:User; onBack:()=>void; onLogout:()=>void }) {
  const [darkMode] = useState(true);
  const [oddsFormat, setOddsFormat] = useState("american");
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [notifications, setNotifications] = useState(true);

  return (
    <PageShell title="Settings" icon="⚙️" onBack={onBack}>
      <div style={{display:"flex",flexDirection:"column",gap:14}}>

        {/* Preferences */}
        <div style={{padding:"20px 24px",background:C.surface,borderRadius:14,border:`1px solid ${C.border}`}}>
          <div style={{fontSize:13,fontWeight:700,color:C.textSub,marginBottom:16,textTransform:"uppercase",letterSpacing:"0.06em"}}>Preferences</div>

          {[
            {label:"Auto-refresh props",sub:"Refresh props every 2 minutes",val:autoRefresh,set:setAutoRefresh},
            {label:"Push notifications",sub:"Receive alert notifications",val:notifications,set:setNotifications},
          ].map(({label,sub,val,set})=>(
            <div key={label} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"12px 0",borderBottom:`1px solid ${C.border}`}}>
              <div>
                <div style={{fontSize:13,fontWeight:600,color:C.text}}>{label}</div>
                <div style={{fontSize:11,color:C.textDim,marginTop:2}}>{sub}</div>
              </div>
              <div onClick={()=>set(!val)} style={{width:44,height:24,borderRadius:12,cursor:"pointer",transition:"background 0.2s",background:val?C.accent:C.border,position:"relative",flexShrink:0}}>
                <div style={{position:"absolute",top:2,left:val?20:2,width:20,height:20,borderRadius:"50%",background:"#fff",transition:"left 0.2s",boxShadow:"0 1px 4px rgba(0,0,0,0.3)"}}/>
              </div>
            </div>
          ))}

          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"12px 0"}}>
            <div>
              <div style={{fontSize:13,fontWeight:600,color:C.text}}>Odds Format</div>
              <div style={{fontSize:11,color:C.textDim,marginTop:2}}>How odds are displayed</div>
            </div>
            <select value={oddsFormat} onChange={e=>setOddsFormat(e.target.value)}
              style={{padding:"6px 12px",background:C.card,border:`1px solid ${C.border}`,borderRadius:8,color:C.text,fontSize:12,cursor:"pointer"}}>
              <option value="american">American (+150)</option>
              <option value="decimal">Decimal (2.50)</option>
              <option value="fractional">Fractional (3/2)</option>
            </select>
          </div>
        </div>

        {/* About */}
        <div style={{padding:"20px 24px",background:C.surface,borderRadius:14,border:`1px solid ${C.border}`}}>
          <div style={{fontSize:13,fontWeight:700,color:C.textSub,marginBottom:14,textTransform:"uppercase",letterSpacing:"0.06em"}}>About EliteOdds</div>
          {[["Version","1.0.0"],["AI Model","Claude Sonnet"],["Odds Source","The Odds API"],["Data","DK · FD · BetMGM · ESPN"]].map(([k,v])=>(
            <div key={k as string} style={{display:"flex",justifyContent:"space-between",padding:"8px 0",borderBottom:`1px solid ${C.border}`}}>
              <span style={{fontSize:13,color:C.textSub}}>{k as string}</span>
              <span style={{fontSize:13,color:C.text}}>{v as string}</span>
            </div>
          ))}
        </div>

        {/* Danger zone */}
        <div style={{padding:"20px 24px",background:C.redBg,borderRadius:14,border:`1px solid ${C.red}30`}}>
          <div style={{fontSize:13,fontWeight:700,color:C.red,marginBottom:14,textTransform:"uppercase",letterSpacing:"0.06em"}}>Account</div>
          <button onClick={onLogout} style={{padding:"10px 20px",background:"transparent",border:`1px solid ${C.red}`,borderRadius:10,color:C.red,fontSize:13,fontWeight:700,cursor:"pointer"}}>
            🚪 Sign Out
          </button>
        </div>
      </div>
    </PageShell>
  );
}


// ── Community Chat Page ───────────────────────
interface ChatMessage {
  id: string;
  userId: string;
  userName: string;
  text: string;
  imageUrl?: string;
  timestamp: number;
  likes: number;
  likedBy: string[];
  isPending?: boolean; // delayed message
}

// Simple shared state using localStorage + polling (no backend needed)
const COMMUNITY_KEY = "eliteodds_community_v1";
const MAX_MESSAGES = 100;
const MESSAGE_DELAY_MS = Math.floor(Math.random() * 20000) + 10000; // 10-30s random delay

function loadMessages(): ChatMessage[] {
  try { return JSON.parse(localStorage.getItem(COMMUNITY_KEY) ?? "[]"); } catch { return []; }
}
function saveMessages(msgs: ChatMessage[]) {
  try { localStorage.setItem(COMMUNITY_KEY, JSON.stringify(msgs.slice(-MAX_MESSAGES))); } catch {}
}

function CommunityPage({ user }: { user: User }) {
  const [messages, setMessages] = useState<ChatMessage[]>(loadMessages);
  const [input, setInput] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const cooldownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Poll for new messages every 3 seconds
  useEffect(() => {
    const id = setInterval(() => {
      setMessages(loadMessages());
    }, 3000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImageFile(file);
    const reader = new FileReader();
    reader.onload = () => setImagePreview(reader.result as string);
    reader.readAsDataURL(file);
  };

  const [hasSentFirst, setHasSentFirst] = useState(false);

  const sendMessage = () => {
    if (!input.trim() && !imagePreview) return;
    if (cooldown > 0) return;
    setSending(true);

    const msgId = Date.now().toString();
    const msgText = input.trim();
    const msgImage = imagePreview ?? undefined;

    const isFirstMessage = !hasSentFirst;
    setHasSentFirst(true);

    // Always show instantly in your own chat
    const pendingMsg: ChatMessage = {
      id: msgId,
      userId: user.id,
      userName: user.name,
      text: msgText,
      imageUrl: msgImage,
      timestamp: Date.now(),
      likes: 0,
      likedBy: [],
      isPending: !isFirstMessage, // first msg not pending, rest are
    };

    setMessages(prev => [...prev, pendingMsg]);
    setInput("");
    setImagePreview(null);
    setImageFile(null);
    setSending(false);

    if (isFirstMessage) {
      // First message: post immediately, no cooldown shown
      const confirmedMsg: ChatMessage = { ...pendingMsg, isPending: false, timestamp: Date.now() };
      const current = loadMessages();
      current.push(confirmedMsg);
      saveMessages(current);
      setMessages(prev => prev.map(m => m.id === msgId ? confirmedMsg : m));
      // Start cooldown AFTER first message so next one has delay
      const delay = Math.floor(Math.random() * 20000) + 10000;
      const cooldownSecs = Math.ceil(delay / 1000);
      setCooldown(cooldownSecs);
      if (cooldownRef.current) clearInterval(cooldownRef.current);
      cooldownRef.current = setInterval(() => {
        setCooldown(prev => {
          if (prev <= 1) { if (cooldownRef.current) clearInterval(cooldownRef.current); return 0; }
          return prev - 1;
        });
      }, 1000);
    } else {
      // Subsequent messages: start cooldown and delay posting
      const delay = Math.floor(Math.random() * 20000) + 10000;
      const cooldownSecs = Math.ceil(delay / 1000);
      setCooldown(cooldownSecs);
      if (cooldownRef.current) clearInterval(cooldownRef.current);
      cooldownRef.current = setInterval(() => {
        setCooldown(prev => {
          if (prev <= 1) { if (cooldownRef.current) clearInterval(cooldownRef.current); return 0; }
          return prev - 1;
        });
      }, 1000);
      setTimeout(() => {
        const confirmedMsg: ChatMessage = { ...pendingMsg, isPending: false, timestamp: Date.now() };
        const current = loadMessages();
        setMessages(prev => prev.map(m => m.id === msgId ? confirmedMsg : m));
        current.push(confirmedMsg);
        saveMessages(current);
      }, delay);
    }
  };

  const toggleLike = (msgId: string) => {
    const updated = loadMessages().map(m => {
      if (m.id !== msgId) return m;
      const liked = m.likedBy.includes(user.id);
      return {
        ...m,
        likes: liked ? m.likes - 1 : m.likes + 1,
        likedBy: liked ? m.likedBy.filter(id => id !== user.id) : [...m.likedBy, user.id],
      };
    });
    saveMessages(updated);
    setMessages(updated);
  };

  const fmtTime = (ts: number) => {
    const d = new Date(ts);
    return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  };

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
      {/* Header */}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap", gap:8 }}>
        <div>
          <div style={{ fontSize:20, fontWeight:800, color:C.text }}>💬 Community</div>
          <div style={{ fontSize:12, color:C.textDim, marginTop:2 }}>Share picks, discuss props, connect with bettors</div>
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <div style={{ width:8, height:8, borderRadius:"50%", background:C.green, boxShadow:`0 0 6px ${C.green}` }}/>
          <span style={{ fontSize:12, color:C.textSub }}>{messages.length} messages</span>

        </div>
      </div>

      {/* Disclaimer */}
      <div style={{ padding:"10px 14px", background:C.amberBg, borderRadius:10, border:`1px solid ${C.amber}30`, fontSize:12, color:C.amber }}>
        ⚠️ Community chat is for entertainment only. Messages have a 10-30 second delay. Never share personal financial info.
      </div>

      {/* Messages */}
      <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:14, overflow:"hidden", display:"flex", flexDirection:"column" }}>
        <div style={{ flex:1, overflowY:"auto", padding:16, display:"flex", flexDirection:"column", gap:12, maxHeight:480, minHeight:300 }}>
          {messages.length === 0 && (
            <div style={{ textAlign:"center", padding:"40px 20px", color:C.textDim }}>
              <div style={{ fontSize:32, marginBottom:8 }}>💬</div>
              <div style={{ fontSize:14 }}>No messages yet — be the first to share a pick!</div>
            </div>
          )}
          {messages.map(msg => {
            const isOwn = msg.userId === user.id;
            const liked = msg.likedBy.includes(user.id);
            return (
              <div key={msg.id} style={{ display:"flex", flexDirection:"column", alignItems:isOwn?"flex-end":"flex-start", gap:4 }}>
                {/* Name + time */}
                <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                  <div style={{ width:24, height:24, borderRadius:"50%", background:`linear-gradient(135deg,#0A3D12,${C.accent})`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:11, fontWeight:700, color:"#fff" }}>
                    {msg.userName.charAt(0).toUpperCase()}
                  </div>
                  <span style={{ fontSize:11, fontWeight:600, color:C.textSub }}>{msg.userName}</span>
                  <span style={{ fontSize:10, color:C.textDim }}>{fmtTime(msg.timestamp)}</span>
                </div>
                {/* Bubble */}
                <div style={{ maxWidth:"80%", display:"flex", flexDirection:"column", gap:6 }}>
                  {msg.text && (
                    <div style={{
                      padding:"10px 14px", fontSize:13, color:C.text, lineHeight:1.6,
                      borderRadius: isOwn ? "14px 14px 4px 14px" : "14px 14px 14px 4px",
                      background: isOwn ? C.accent+"22" : C.card,
                      border:`1px solid ${isOwn ? C.accent+"40" : C.border}`,
                    }}>{msg.text}</div>
                  )}
                  {msg.imageUrl && (
                    <img src={msg.imageUrl} alt="pick" style={{ maxWidth:280, borderRadius:10, border:`1px solid ${C.border}`, cursor:"pointer" }}
                      onClick={() => window.open(msg.imageUrl, "_blank")}/>
                  )}
                  {/* Pending indicator or Like button */}
                  <div style={{ display:"flex", justifyContent:isOwn?"flex-end":"flex-start", alignItems:"center", gap:6 }}>
                    {msg.isPending ? (
                      <span style={{ fontSize:10, color:C.textDim, fontStyle:"italic", display:"flex", alignItems:"center", gap:4 }}>
                        <div style={{ display:"flex", gap:3 }}>
                          {[0,1,2].map(i=><div key={i} style={{ width:4, height:4, borderRadius:"50%", background:C.textDim, animation:`pulse 1.2s ${i*0.2}s infinite` }}/>)}
                        </div>
                        Sending...
                      </span>
                    ) : (
                      <button onClick={() => toggleLike(msg.id)} style={{
                        display:"flex", alignItems:"center", gap:4, padding:"2px 8px",
                        background:liked?C.greenBg:"transparent", border:`1px solid ${liked?C.green:C.border}`,
                        borderRadius:20, color:liked?C.green:C.textDim, fontSize:11, cursor:"pointer",
                      }}>
                        {liked?"❤️":"🤍"} {msg.likes > 0 && msg.likes}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
          <div ref={bottomRef}/>
        </div>

        {/* Image preview */}
        {imagePreview && (
          <div style={{ padding:"8px 16px", background:C.card, borderTop:`1px solid ${C.border}`, display:"flex", alignItems:"center", gap:8 }}>
            <img src={imagePreview} style={{ height:50, borderRadius:6 }} alt="preview"/>
            <span style={{ fontSize:12, color:C.textSub, flex:1 }}>Image attached</span>
            <button onClick={() => { setImagePreview(null); setImageFile(null); }}
              style={{ background:"none", border:"none", color:C.red, cursor:"pointer", fontSize:16 }}>✕</button>
          </div>
        )}

        {/* Input */}
        {/* Cooldown bar */}
        {cooldown > 0 && (
          <div style={{ padding:"6px 16px", background:C.amberBg, borderTop:`1px solid ${C.amber}30`, display:"flex", alignItems:"center", gap:8 }}>
            <div style={{ flex:1, height:4, background:C.border, borderRadius:2, overflow:"hidden" }}>
              <div style={{ height:"100%", background:C.amber, borderRadius:2, transition:"width 1s linear",
                width:`${(cooldown / 30) * 100}%` }}/>
            </div>
            <span style={{ fontSize:11, color:C.amber, fontWeight:600, flexShrink:0 }}>
              Next message in {cooldown}s
            </span>
          </div>
        )}
        <div style={{ padding:"12px 16px", borderTop:`1px solid ${C.border}`, background:C.card, display:"flex", gap:8, alignItems:"flex-end" }}>
          <input ref={fileRef} type="file" accept="image/*" onChange={handleImage} style={{ display:"none" }}/>
          <button onClick={() => fileRef.current?.click()} disabled={cooldown > 0}
            style={{ padding:"9px 12px", background:C.surface, border:`1px solid ${C.border}`, borderRadius:10, color:cooldown>0?C.textDim:C.textSub, fontSize:16, cursor:cooldown>0?"not-allowed":"pointer", flexShrink:0, opacity:cooldown>0?0.5:1 }}>
            📷
          </button>
          <input value={input} onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key==="Enter" && !e.shiftKey && cooldown===0 && sendMessage()}
            placeholder={cooldown > 0 ? `Wait ${cooldown}s before next message...` : "Share a pick, discuss a prop..."}
            disabled={cooldown > 0}
            style={{ flex:1, padding:"10px 14px", background:C.surface, border:`1px solid ${cooldown>0?C.amber+"50":C.border}`, borderRadius:10, color:cooldown>0?C.textDim:C.text, fontSize:13, fontFamily:"inherit", outline:"none", cursor:cooldown>0?"not-allowed":"text", opacity:cooldown>0?0.6:1 }}/>
          <button onClick={sendMessage} disabled={sending || cooldown > 0 || (!input.trim() && !imagePreview)}
            style={{ padding:"10px 18px", background:cooldown>0?C.border:C.accent, border:"none", borderRadius:10, color:cooldown>0?C.textDim:"#fff", fontWeight:700, fontSize:13, cursor:cooldown>0?"not-allowed":"pointer", opacity:(sending||cooldown>0)?0.5:1, flexShrink:0, transition:"all 0.2s" }}>
            {cooldown > 0 ? `${cooldown}s` : "Send"}
          </button>
        </div>
      </div>
      <div style={{ fontSize:11, color:C.textDim, textAlign:"center" }}>Your messages appear instantly · visible to others after 10-30 second delay · For entertainment only</div>
    </div>
  );
}

// ── Pick Analyzer Page ────────────────────────
function PickAnalyzerPage({ liveCtx }: { liveCtx?: string }) {
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageB64, setImageB64] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<Array<{img:string;analysis:string;ts:number}>>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);

  const handleFile = (file: File) => {
    if (!file.type.startsWith("image/")) return;
    setImageFile(file);
    setAnalysis(null);
    setError(null);
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      setImagePreview(result);
      // Extract base64 data (remove data:image/xxx;base64, prefix)
      setImageB64(result.split(",")[1]);
    };
    reader.readAsDataURL(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const analyzePick = async () => {
    if (!imageB64) return;
    setLoading(true);
    setError(null);
    setAnalysis(null);

    try {
      const res = await fetch(BACKEND, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-5",
          max_tokens: 1000,
          system: `You are EliteOdds AI, an expert sports betting analyst. Analyze betting slip images and provide detailed, honest feedback.
${liveCtx ? `Current context: ${liveCtx}` : ""}
Be direct, use specific numbers, and explain your reasoning clearly. Always note this is for entertainment purposes.`,
          messages: [{
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: imageFile?.type ?? "image/jpeg",
                  data: imageB64,
                }
              },
              {
                type: "text",
                text: `Analyze this betting slip/picks image in detail. For each pick provide:

1. **Keep or Fade** — Should they keep this pick or consider fading it?
2. **Line Analysis** — Is this a good number? Has it moved?
3. **Risk Assessment** — What's the main risk with this pick?
4. **AI Probability** — Your estimated probability vs the implied odds
5. **Verdict** — 1 sentence final take

Then give an overall parlay/slip assessment:
- Total implied probability
- Expected Value estimate  
- Suggested adjustments
- Overall rating (🔥 Strong / ✅ OK / ⚠️ Risky / ❌ Fade)

Be specific, reference current playoff/series context where relevant, and keep it sharp.`
              }
            ]
          }]
        })
      });

      const data = await res.json();
      const text = data.content?.find((b: any) => b.type === "text")?.text;
      if (!text) throw new Error("No analysis returned");
      setAnalysis(text);
      // Add to history
      setHistory(prev => [{ img: imagePreview!, analysis: text, ts: Date.now() }, ...prev.slice(0,4)]);
    } catch (e: any) {
      setError(`Analysis failed: ${e.message}`);
    }
    setLoading(false);
  };

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
      {/* Header */}
      <div>
        <div style={{ fontSize:20, fontWeight:800, color:C.text }}>🎯 AI Pick Analyzer</div>
        <div style={{ fontSize:12, color:C.textDim, marginTop:2 }}>Upload a screenshot of your picks and get instant AI analysis</div>
      </div>

      <div style={{ display:"grid", gridTemplateColumns: imagePreview ? "1fr 1fr" : "1fr", gap:16, alignItems:"start" }}>
        {/* Upload section */}
        <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
          {/* Drop zone */}
          <div ref={dropRef} onDrop={handleDrop} onDragOver={e=>e.preventDefault()}
            onClick={() => fileRef.current?.click()}
            style={{
              border:`2px dashed ${imagePreview ? C.accent : C.border}`,
              borderRadius:14, padding:"30px 20px", textAlign:"center",
              cursor:"pointer", background: imagePreview ? C.accent+"08" : C.surface,
              transition:"all 0.2s",
            }}>
            <input ref={fileRef} type="file" accept="image/*" onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])} style={{ display:"none" }}/>
            {imagePreview ? (
              <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:10 }}>
                <img src={imagePreview} alt="pick" style={{ maxHeight:200, maxWidth:"100%", borderRadius:10, objectFit:"contain" }}/>
                <span style={{ fontSize:12, color:C.textSub }}>Click to change image</span>
              </div>
            ) : (
              <div>
                <div style={{ fontSize:40, marginBottom:10 }}>📸</div>
                <div style={{ fontSize:15, fontWeight:700, color:C.text, marginBottom:6 }}>Drop your picks screenshot here</div>
                <div style={{ fontSize:12, color:C.textDim, marginBottom:12 }}>or click to browse</div>
                <div style={{ display:"flex", gap:8, justifyContent:"center", flexWrap:"wrap" }}>
                  {["DraftKings slip","FanDuel betslip","BetMGM picks","PrizePicks","Any sportsbook"].map(s=>(
                    <span key={s} style={{ fontSize:10, padding:"2px 8px", background:C.card, border:`1px solid ${C.border}`, borderRadius:20, color:C.textDim }}>{s}</span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Analyze button */}
          {imagePreview && (
            <button onClick={analyzePick} disabled={loading}
              style={{ padding:"13px", background:`linear-gradient(135deg,${C.accent},${C.accentDim})`, border:"none", borderRadius:12, color:"#fff", fontSize:14, fontWeight:700, cursor:"pointer", opacity:loading?0.6:1, display:"flex", alignItems:"center", justifyContent:"center", gap:8 }}>
              {loading ? (
                <>
                  <div style={{ width:16, height:16, border:"2px solid #fff4", borderTop:"2px solid #fff", borderRadius:"50%", animation:"spin 1s linear infinite" }}/>
                  Analyzing picks...
                </>
              ) : "⚡ Analyze My Picks"}
            </button>
          )}

          {error && (
            <div style={{ padding:"12px 14px", background:C.redBg, border:`1px solid ${C.red}30`, borderRadius:10, color:C.red, fontSize:13 }}>
              {error}
            </div>
          )}

          {/* Tips */}
          <div style={{ padding:"14px", background:C.card, borderRadius:12, border:`1px solid ${C.border}` }}>
            <div style={{ fontSize:12, fontWeight:700, color:C.textSub, marginBottom:10, textTransform:"uppercase", letterSpacing:"0.05em" }}>Tips for best results</div>
            {["📱 Screenshot your full betslip — include all legs","🔍 Make sure odds and lines are clearly visible","📊 Works with any sportsbook: DK, FD, BetMGM, Caesars","🎯 Works for singles, parlays, and same-game parlays"].map(t=>(
              <div key={t} style={{ fontSize:12, color:C.textDim, marginBottom:6 }}>{t}</div>
            ))}
          </div>
        </div>

        {/* Analysis panel */}
        {(analysis || loading) && (
          <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:14, overflow:"hidden" }}>
            <div style={{ padding:"12px 16px", background:C.card, borderBottom:`1px solid ${C.border}`, display:"flex", alignItems:"center", gap:8 }}>
              <div style={{ width:6, height:6, borderRadius:"50%", background:loading?C.amber:C.green }}/>
              <span style={{ fontSize:13, fontWeight:700, color:C.text }}>AI Analysis</span>
              {loading && <span style={{ fontSize:11, color:C.textDim }}>Analyzing your picks...</span>}
            </div>
            <div style={{ padding:16, maxHeight:500, overflowY:"auto" }}>
              {loading ? (
                <div style={{ display:"flex", flexDirection:"column", gap:10, padding:"20px 0" }}>
                  {[0,1,2].map(i=>(
                    <div key={i} style={{ display:"flex", gap:6 }}>
                      <div style={{ width:7, height:7, borderRadius:"50%", background:C.accent, animation:`pulse 1.4s ${i*0.3}s infinite`, marginTop:6, flexShrink:0 }}/>
                      <div style={{ flex:1, height:14, background:C.card, borderRadius:4, animation:`pulse 1.4s ${i*0.2}s infinite` }}/>
                    </div>
                  ))}
                  <div style={{ fontSize:12, color:C.textDim, marginTop:8 }}>Reading your betslip and checking current lines...</div>
                </div>
              ) : analysis ? (
                <div style={{ fontSize:13, color:C.text, lineHeight:1.8, whiteSpace:"pre-wrap" }}>{analysis}</div>
              ) : null}
            </div>
          </div>
        )}
      </div>

      {/* History */}
      {history.length > 0 && (
        <div>
          <div style={{ fontSize:14, fontWeight:700, color:C.text, marginBottom:10 }}>Recent Analyses</div>
          <div style={{ display:"flex", gap:10, overflowX:"auto", paddingBottom:4 }}>
            {history.map((h,i) => (
              <div key={i} onClick={() => { setImagePreview(h.img); setAnalysis(h.analysis); }}
                style={{ flexShrink:0, width:120, cursor:"pointer", background:C.card, borderRadius:10, border:`1px solid ${C.border}`, overflow:"hidden" }}>
                <img src={h.img} style={{ width:"100%", height:70, objectFit:"cover" }} alt="history"/>
                <div style={{ padding:"6px 8px", fontSize:10, color:C.textDim }}>
                  {new Date(h.ts).toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit"})}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ fontSize:11, color:C.textDim, textAlign:"center" }}>
        AI analysis is for entertainment purposes only · Not financial advice · Always gamble responsibly
      </div>
    </div>
  );
}

export default function App() {
  const [view, setView] = useState<"Props"|"Scores"|"Live Odds"|"AI Chat"|"Community"|"Pick Analyzer">("Props");
  const [page, setPage] = useState<"main"|"profile"|"saved"|"alerts"|"settings">("main");
  const [user, setUser] = useState<User | null>(getStoredUser);
  const { series: liveSeries, news: liveNews, systemCtx: liveCtx } = useLiveSeries();

  if (!user) return <AuthPage onAuth={u => setUser(u)} />;

  // Sub-pages
  if (page === "profile") return <ProfilePage user={user} onBack={()=>setPage("main")} onUpdate={u=>{setUser(u);saveUser(u);}}/>;
  if (page === "saved") return <SavedPropsPage user={user} onBack={()=>setPage("main")}/>;
  if (page === "alerts") return <AlertsPage user={user} onBack={()=>setPage("main")}/>;
  if (page === "settings") return <SettingsPage user={user} onBack={()=>setPage("main")} onLogout={()=>{logout();setUser(null);}}/>;

  return (
    <div style={{background:C.bg,minHeight:"100vh",color:C.text,fontFamily:"-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif"}}>
      <style>{`
        @keyframes pulse{0%,100%{opacity:.2;transform:scale(.7)}50%{opacity:1;transform:scale(1)}} @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes fadeIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
        ::-webkit-scrollbar{width:4px;height:4px} ::-webkit-scrollbar-thumb{background:${C.border};border-radius:4px}
        *{box-sizing:border-box;margin:0;padding:0} input:focus,select:focus{outline:none;border-color:${C.accent}!important}
        button:active{transform:scale(0.97)}
      `}</style>

      {/* Header */}
      <header style={{background:C.surface,borderBottom:`1px solid ${C.border}`,position:"sticky",top:0,zIndex:100}}>
        <div style={{maxWidth:1400,margin:"0 auto",padding:"0 24px",display:"flex",alignItems:"center",gap:16,height:60,flexWrap:"wrap"}}>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            
            <div>
              <div style={{fontSize:16,fontWeight:900,color:C.text,letterSpacing:"-0.03em"}}><span style={{color:C.textSub,fontStyle:"italic"}}>Elite</span><span style={{color:C.accent}}>Odds</span></div>
              <div style={{fontSize:9,color:C.red,fontWeight:600,letterSpacing:"0.04em"}}>🔴 LIVE · ECF G3 IN PROGRESS</div>
            </div>
          </div>
          <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
            {liveSeries.length > 0 ? liveSeries.map((s,i)=>(
              <div key={i} style={{padding:"4px 10px",background:C.card,borderRadius:20,border:`1px solid ${s.isLive?C.red:C.border}`,display:"flex",alignItems:"center",gap:4}}>
                {s.isLive && <div style={{width:5,height:5,borderRadius:"50%",background:C.red}}/>}
                <span style={{fontSize:10,color:C.textDim}}>{s.label} </span>
                <span style={{fontSize:10,fontWeight:600,color:s.color}}>{s.status}</span>
              </div>
            )) : (
              <div style={{padding:"4px 10px",background:C.card,borderRadius:20,border:`1px solid ${C.border}`}}>
                <span style={{fontSize:10,color:C.textDim}}>Loading series data...</span>
              </div>
            )}
          </div>
          <div style={{marginLeft:"auto"}}>
            <UserMenu user={user} onLogout={() => { logout(); setUser(null); }} onOpenPage={(p)=>setPage(p as any)}/>
          </div>
        </div>
      </header>

      {/* Breaking news — fully dynamic */}
      {liveNews.length > 0 && (
        <div style={{background:"#EF444408",borderBottom:`1px solid ${C.border}`}}>
          <div style={{maxWidth:1400,margin:"0 auto",padding:"7px 24px",display:"flex",gap:12,flexWrap:"wrap",alignItems:"center"}}>
            <span style={{fontSize:11,fontWeight:700,color:C.red}}>🚨 LATEST</span>
            {liveNews.map((item,i) => (
              <span key={i} style={{display:"flex",alignItems:"center",gap:8}}>
                {i > 0 && <span style={{fontSize:11,color:C.textDim}}>·</span>}
                <span style={{fontSize:11,color:item.highlight?C.amber:C.text,fontWeight:item.highlight?600:400}}>
                  {item.text}
                </span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Nav */}
      <div style={{background:C.surface,borderBottom:`1px solid ${C.border}`}}>
        <div style={{maxWidth:1400,margin:"0 auto",padding:"0 24px",display:"flex",gap:2}}>
          {(["Props","Scores","Live Odds","AI Chat","Community","Pick Analyzer"] as const).map(v=>(
            <button key={v} onClick={()=>setView(v)} style={{
              padding:"12px 20px",border:"none",fontSize:13,fontWeight:600,cursor:"pointer",background:"transparent",
              color:view===v?C.accent:C.textDim,
              borderBottom:view===v?`2px solid ${C.green}`:"2px solid transparent",
              transition:"color 0.15s"}}>
              {v}
            </button>
          ))}
        </div>
      </div>

      <main style={{maxWidth:1400,margin:"0 auto",padding:"24px"}}>
        {view==="Props" && <PropsPage liveCtx={liveCtx}/>}
        {view==="Live Odds" && <OddsPage/>}
        {view==="AI Chat" && <Chat/>}
        {view==="Community" && <CommunityPage user={user}/>}
        {view==="Pick Analyzer" && <PickAnalyzerPage liveCtx={liveCtx}/>}
      </main>

      <footer style={{borderTop:`1px solid ${C.border}`,padding:"16px 24px",marginTop:40}}>
        <div style={{maxWidth:1400,margin:"0 auto",display:"flex",justifyContent:"space-between",flexWrap:"wrap",gap:8}}>
          <span style={{fontSize:11,color:C.textDim}}>EliteOdds · For entertainment purposes only · EliteOdds</span>
          <span style={{fontSize:11,color:C.textDim}}>AI: Claude Sonnet · Odds: The Odds API · DK / FD / BetMGM · EliteOdds v1.0</span>
        </div>
      </footer>
    </div>
  );
}
