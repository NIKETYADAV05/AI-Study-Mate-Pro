"""
AI StudyMate Pro — Notes Summarizer API Views
---------------------------------------------
Extractive NLP summariser (no external API, no paid service).

Algorithm:
  1. Separate headings from prose sentences.
  2. Score prose sentences by TF-IDF-style word frequency.
  3. Select the top-N sentences and return them in original order.
  4. Build key points from the best sentences (not headings).
  5. Extract important terms using frequency, excluding junk words.
"""

import json
import math
import re
from collections import Counter
from difflib import SequenceMatcher

# Sentinel characters used internally — plain chr() values, never regex escapes
_HEADING_MARK = chr(1) + "H" + chr(1)   # marks a heading line
_ABBREV_MARK  = chr(2)                   # temporarily replaces '.' in abbreviations

from django.http import JsonResponse
from django.views.decorators.http import require_http_methods

# ── Constants ──────────────────────────────────────────────────────────────────

MAX_INPUT_CHARS  = 20_000
MIN_INPUT_CHARS  = 50
WORDS_PER_SECOND = 200 / 60   # ~3.33 words/sec → reading time

# Sentence counts per summary length: (min, max, section_budget_fraction)
# section_budget_fraction = fraction of budget allocated per detected section
LENGTH_MAP = {
    "short":    (3, 5),
    "medium":   (6, 10),
    "detailed": (10, 16),
}

# ── Stop-words (expanded) ──────────────────────────────────────────────────────
STOP_WORDS = {
    # articles / prepositions / conjunctions
    "a","an","the","and","or","but","in","on","at","to","for","of","with",
    "by","from","up","about","into","through","during","before","after",
    "above","below","between","among","within","without","against","along",
    "following","across","behind","beyond","plus","except","but","up","out",
    "around","down","off","above","near",
    # auxiliaries / verbs
    "is","are","was","were","be","been","being","have","has","had","do",
    "does","did","will","would","could","should","may","might","shall",
    "can","need","dare","ought","used","not","no","nor","get","got","make",
    "made","use","used","using","also","thus","hence","therefore","however",
    # pronouns
    "it","its","this","that","these","those","i","me","my","we","our","you",
    "your","he","she","they","them","their","what","which","who","how",
    "when","where","why","him","her","his","one","two","three","four","five",
    # filler adjectives / adverbs
    "so","yet","both","either","neither","each","few","more","most","other",
    "some","such","only","own","same","than","too","very","just","because",
    "as","until","while","all","any","then","there","here","if","new","like",
    "many","much","well","even","still","already","often","always","never",
    "now","back","way","first","last","next","good","great","large","small",
    "high","low","long","short","old","young","important","known","given",
    "since","under","over","per","set","put","let","say","said","according",
    "based","called","named","used","various","several","certain","related",
    "different","specific","general","another","later","earlier","known",
    "while","where","whether","both","between","due","via","vs","etc",
    "overview","introduction","refer","refers","reflect","reflects","shift",
    "driven","drive","drives","need","needs","provide","provides","provided",
    "include","includes","including","offer","offers","describe","describes",
}

# Generic single-word terms that add no domain value as important terms.
GENERIC_TERMS = {
    # action/description words (including gerunds)
    "like","new","overview","introduction","refer","refers","shift","driven",
    "drive","need","provide","include","offer","describe","use","used","using",
    "building","built","build","enable","enables","support","supports","allow",
    "allows","run","runs","write","written","manage","manages","remain",
    "simplify","simplifies","address","addresses","package","packages",
    "providing","offering","enabling","supporting","allowing","running",
    "writing","managing","building","addressing","programming","addressing",
    "decompose","decomposes","orchestrate","orchestrates","migrate","migrates",
    "emerge","emerged","evolve","evolved","donate","donated","rename","renamed",
    # structural/generic nouns
    "system","systems","model","models","code","version","feature","features",
    "approach","approaches","concept","concepts","technology","technologies",
    "multi","tier","scale","type","part","area","role","term","point","fact",
    "thing","item","topic","field","form","kind","ways","sets","wide","main",
    "container","containers","runtime","runtimes","dependency","dependencies",
    # generic tech nouns (too broad to be a useful term on their own)
    "application","applications","server","servers","platform","platforms",
    "enterprise","framework","frameworks","service","services","component",
    "components","interface","interfaces","layer","layers","module","modules",
    "library","libraries","project","projects","environment","environments",
    "architecture","pattern","patterns","standard","standards","solution",
    "solutions","method","methods","class","classes","object","objects",
    # generic adjectives/adverbs
    "distributed","secure","network","primarily","standalone","external",
    "lightweight","portable","compliant","independently","deployable",
    "automatically","asynchronous","synchronous","commonly","widely","today",
    "originally","typically","directly","efficiently","easily","simply",
    "standardized","original","excessive","boilerplate","alternative",
    "embedded","auto","native","cloud","modern","popular","widely",
    "programming","annotation","annotations","namespace","namespaces",
    "implementation","implementations","abstraction","abstractions",
    "complexity","configuration","injection","oriented","aspect",
    "access","accesses","query","queries","store","stores","data",
    "boot","core","base","back","front","end","side","level","low",
    "high","full","open","source","free","paid","real","time","live",
    "responsibility","responsibilities","characteristic","characteristics",
    "benefit","benefits","advantage","advantages","disadvantage","challenge",
    "requirement","requirements","functionality","functionalities","detail",
    "development","developer","developers","communicate","communicates",
    "communication","interact","interacts","interaction","perform","performs",
    "deployment","deploy","deploys","configure","configures","process",
    "processes","distinct","defined","well","consist","consists","follow",
    "consisting","relational","monolithic","lifecycle","transaction","portable",
    "compliant","security","transactions","resource","resources","runtime",
    "scalable","scalability","maintainable","maintainability","independent",
    "criticized","simplified","migrated","transferred","renamed","donated",
    "emerged","evolved","introduced","offered","provided","enabled","supported",
    "optimized","decomposed","orchestrated","packaged","implemented","replaced",
    "extended","developed","reduced","increased","improved","enhanced","created",
    "written","built","designed","called","named","known","given","allowed",
    "foundation","repository","repositories","abstraction","abstractions",
    "interface","interfaces","annotation","annotations","boilerplate",
    "injection","aspect","oriented","programming","programmatic",
    # more generic words that keep appearing
    "ecosystem","specification","specifications","compatibility","standardize",
    "standardizes","standardized","performance","improvement","improvements",
    "evolution","community","agility","flexibility","flexible","complex",
    "complexity","driven","drives","widely","world","large","multi","scale",
    "version","versions","rename","transfer","introduce","introduces","simplify",
    "complement","complementary","complemented","popularize","popularized",
    "criticize","criticized","criticism","emerge","emerged","evolve","evolved",
    "migrate","migrated","migration","integrate","integrated","integration",
    "manage","management","handles","handling","tracking","track","provide",
    # adjectives / weak nouns that keep appearing
    "profile","profiles","simpler","recent","javax","web","page","pages",
    "request","requests","response","client","clients","logic","business",
    "host","port","path","file","dir","setter","getter","bean","beans",
    "pojo","pojos","helper","api","apis","simpl","widely","large","small",
    # weak/generic terms found in real API test output that add no domain value
    "isolation","pioneered","breaking","language","smaller","message",
    "retries","circuit","gateway","traffic","restful","construction",
    "infrastructure","prefix","fragment","suffix","context","contexts",
    "traditional","heavyweight","messaging","subscribe","decouple",
    "decouples","database","databases","adopted","adopt","adopts","often",
    "meaning","meaning","monolithic","modular","automatically","auto",
    "alternative","concern","concerns","independently","deployable",
    # generic nouns / adjectives that appear as false terms in OS / general notes
    "operating","user","users","files","file","disk","disks","job","jobs",
    "determine","determines","determined","knowledge","tutorial","tutorials",
    "career","careers","interview","interviews","beginner","beginners",
    "prior","prerequisite","prerequisites","essential","essentially",
    "authority","authorized","authorization","authentication","identity",
    "permit","permitted","permission","permissions","verify","verifies",
    "prevent","prevents","prevented","crash","crashes","error","errors",
    "collect","collects","collected","collected","batch","batches",
    "driver","drivers","buffer","buffers","buffering","cache","caches",
    "caching","spool","spooling","allocate","allocates","allocation",
    "deallocate","deallocates","deallocation","track","tracks","tracking",
    "directory","directories","folder","folders","retrieve","retrieves",
    "retrieval","communicate","communicates","communication","interact",
    # more weak terms observed in OS test output
    "simultaneously","concurrently","concurrent","responsible","responsibility",
    "administration","administrate","administrates","understanding","understand",
    "cybersecurity","unauthorized","permitted","permitted","actions","action",
    "operator","operators","dominant","dominantly",
    # additional OS-domain noise terms
    "engineering","allocating","terminated","smartphone","smartphones",
    "efficiency","processor","processors","algorithm","algorithms",
    "multitask","multitasking","biometrics","biometric","password","passwords",
    "keyboard","keyboards","printer","printers","tablet","tablets",
    "desktop","desktops","laptop","laptops","dominant","emergence",
    # generic participial / past-participle adjectives that surface as false terms
    "executed","retrieved","extended","extended","allocated","deallocated",
    "distributed","protected","accessed","created","deleted","copied","moved",
    "waiting","ready","running","stopped","terminated","finished","started",
    "primary","secondary","physical","logical","internal","external",
    "studying","studied","required","optional","included","excluded",
    "position","positions","question","questions","extension","extensions",
    # generic "JavaBean" — present in almost every Java topic, adds no signal
    "javabean","javabeans","bean","beans","pojo","pojos",
    # other overly-generic nouns that aren't domain terms
    "software","hardware","program","programs","programmer","programmers",
    "computer","computers","machine","machines","network","networks",
    "logic","logics","concept","concepts","principle","principles",
    "mechanism","mechanisms","technique","techniques","approach","approaches",
    # generic verbs / adjectives that score high in short inputs
    "organize","organizes","organized","organizing",
    "decide","decides","decided","deciding",
    "manage","manages","managing",
    "handle","handles","handling","handled",
    "store","stores","storing","stored",
    "access","accesses","accessing","accessed",
    "device","devices","storage","virtual","physical",
    "next","runs","run","running","process","processes","schedule",
    "scheduler","schedulers","paging","page","pages",
    # more verbs and weak adjectives found in test 2 and 3
    "correct","failing","handle","ensure","entire","break","bring",
    "internal","reduces","hides","state","reuse","uses","writes",
    "owns","routes","route","package","packages","scale","scales",
    "written","common","commonly","large","largest","single","multiple",
    "different","various","several","certain","specific","general",
    "important","useful","typical","typically","common","commonly",
    "allow","allows","allowed","enable","enables","enabled","support",
    "supports","supported","require","requires","required","contain",
    "contains","contained","consist","consists","perform","performs",
    "interact","interacts","communicate","communicates","connect",
    "connects","deploy","deploys","deployed","run","runs","running",
    "start","starts","started","stop","stops","stopped","send","sends",
    "receive","receives","call","calls","called","return","returns",
    "returned","create","creates","created","update","updates","updated",
    "delete","deletes","deleted","read","reads","write","writes",
    "define","defines","defined","describe","describes","described",
    # corrupted/weak terms from plural-stripping or low-value nouns
    "meshe","meshes","inter","fault","underlying","represent","exposes",
    "expose","public","parent","hiding","forms","form","subclass",
    "subclasses","superclass","abstract","interface","implement",
    "complex","method","attribute","object","class","variable",
    "function","value","type","return","result","output","input",
    "parameter","argument","instance","inherit","override","extend",
    "polymorphic","encapsulate","abstraction","abstract","concrete",
    "mapping","mapped","maps","table","tables","column","columns",
    "field","fields","entity","entities","session","sessions",
    "protocol","protocols","queue","queues","topic","topics",
    "producer","consumer","consumers","broker","brokers",
    "endpoint","endpoints","proxy","proxies","stub","stubs",
    "adapter","adapters","handler","handlers","listener","listeners",
    "callback","callbacks","wrapper","wrappers","factory","factories",
    "singleton","singletons","stateless","stateful","scope","scopes",
    "interceptor","interceptors","decorator","decorators","observer",
    "providers","produce","produced","inject","injected","qualifier",
    "manager","unit","units","standalone","container","containers",
    "runtime","runtimes","dependency","dependencies","deployment",
    # generic adjectives / adverbs / verbs that keep surfacing as false "terms"
    "maintain","maintains","maintained","maintaining",
    "conversational","conversationally",
    "asynchronous","asynchronously","synchronous","synchronously",
    "lightweight","heavyweight","standalone","portable","scalable",
    "stateful","stateless","multitier","multitiered",
    "widely","commonly","primarily","directly","efficiently",
    "typically","generally","simply","easily","automatically",
    "independent","independently","separately","distinctly",
    "successor","predecessor","alternative","replacement","variant",
    "simplified","standardized","annotated","configured","embedded",
    "renamed","transferred","donated","evolved","emerged","migrated",
    # gerunds and present-tense verbs that look like nouns but aren't domain terms
    "encapsulates","encapsulate","encapsulated","encapsulating",
    "communicates","communicate","communicated","communicating",
    "connects","connect","connected","connecting",
    "exposes","expose","exposed","exposing",
    "simplifies","simplify","simplified","simplifying",
    "decomposes","decompose","decomposed","decomposing",
    "orchestrates","orchestrate","orchestrated","orchestrating",
    "separates","separate","separated","separating",
    "inherits","inherit","inherited","inheriting",
    "overrides","override","overridden","overriding",
    "extends","extend","extended","extending",
    "wraps","wrap","wrapped","wrapping",
    "injects","inject","injected","injecting",
    "validates","validate","validated","validating",
    "registers","register","registered","registering",
    "serializes","serialize","serialized","serializing",
    "deserializes","deserialize","deserialized","deserializing",
    # weak/ambiguous domain words
    "persistence","persistences",   # too generic without "java" or "jpa" prefix
    "lifecycle","lifecycles",
    "specification","specifications",
    "propagation","propagations",
    "isolation","isolations",
    "convention","conventions",
    "boilerplate","boilerplates",
}

# ── Text cleaning ──────────────────────────────────────────────────────────────

def clean_text(text: str) -> str:
    """Normalise line endings, collapse whitespace, strip bullet symbols."""
    text = re.sub(r'\r\n|\r', '\n', text)
    text = re.sub(r'[ \t]+', ' ', text)
    text = re.sub(r'\n{3,}', '\n\n', text)
    # Remove leading bullet/dash symbols on lines but keep the text.
    # Handles:  "- text", "• text", "* text", "▸ text", "► text"
    # Also handles compound markers: "- o text", "* o text" (common in copied notes)
    # and standalone letter-o bullets: "o text" at the very start of a line.
    text = re.sub(r'(?m)^[ \t]*[-•*▸►]\s+(?:o\s+)?', '', text)
    # Strip a lone 'o' used as a bullet at the start of a line
    # (only when followed by an uppercase letter or digit, to avoid stripping
    # legitimate words like "one", "only", etc.)
    text = re.sub(r'(?m)^[ \t]*o\s+(?=[A-Z0-9])', '', text)
    return text.strip()


# ── Heading detection ──────────────────────────────────────────────────────────

# Words that strongly suggest a sentence (not a heading)
_SENTENCE_VERBS = {
    "is","are","was","were","be","been","being","have","has","had",
    "do","does","did","will","would","could","should","may","might",
    "refers","reflect","reflects","drives","driven","introduce","introduces",
    "emerged","evolved","migrated","transferred","renamed","criticized",
    "standardizes","simplify","provide","provides","provided",
}

def is_heading(line: str) -> bool:
    """
    Return True if the line looks like a heading:
    - ≤ 80 chars
    - Does not end with sentence-terminating punctuation
    - Does not contain a verb that makes it a proper sentence
    - Multiple words with title-casing OR ends with ':'
    """
    line = line.strip()
    if not line or len(line) > 80:
        return False
    # Sentences end with punctuation; headings don't
    if re.search(r'[.!?]$', line):
        return False
    words = line.split()
    if not words:
        return False
    # If the line contains a known verb it's a sentence fragment, not a heading
    lower_words = {w.lower().rstrip('.,;:') for w in words}
    if lower_words & _SENTENCE_VERBS:
        return False
    # Lines ending with ':' are definitely section labels
    if line.endswith(':'):
        return True
    # Short lines (≤ 8 words) where most words start with a capital
    capital_count = sum(1 for w in words if w and w[0].isupper())
    if len(words) <= 8 and capital_count >= max(2, len(words) // 2):
        return True
    return False


# ── Sentence splitting ─────────────────────────────────────────────────────────

# Abbreviations that should NOT trigger sentence splits
_ABBREVS = r'(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|vs|etc|approx|dept|corp|inc|ltd|e\.g|i\.e|Fig|fig|No|no|Vol|vol|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Oct|Nov|Dec)'

def split_into_sentences(text: str) -> list[str]:
    """
    Split text into individual sentences while:
    - Treating each non-empty line as a potential sentence boundary
    - Preserving abbreviations (Dr., etc.) and decimal numbers
    - Handling inline heading-sentence hybrids: "Label (ACRONYM): sentence"
    - Not merging headings into surrounding sentences
    - Returning only non-empty, non-heading fragments of ≥ 15 chars
    """
    sentences = []

    # Pattern: "Some Label (OPT_ACRONYM): Sentence starting with capital"
    # Matches lines like "JPA (Java Persistence API): JPA is the standard..."
    # Captures: group(1) = label, group(2) = sentence after colon.
    # {2,80} so long labels like "JAAS (Java Authentication and Authorization Service):" match.
    _INLINE_HYBRID = re.compile(
        r'^([A-Z][^:\n]{2,80}(?:\([A-Za-z ]{2,40}\))?)\s*:\s*([A-Z].{10,})$'
    )

    # First split on paragraph / line boundaries
    for block in re.split(r'\n+', text):
        block = block.strip()
        if not block:
            continue
        if is_heading(block):
            sentences.append(_HEADING_MARK + block)
            continue

        # Handle inline heading-sentence hybrids.
        # Only strip the label prefix if the remaining sentence is a complete,
        # subject-bearing sentence (does NOT start with "The ", "A ", "An ",
        # "This ", "These " — which are likely predicate fragments, not full sentences).
        hybrid_match = _INLINE_HYBRID.match(block)
        if hybrid_match:
            after_colon = hybrid_match.group(2).strip()
            # Keep the full original line if the text after the colon is a fragment:
            # - Starts with article (The/A/An) → predicate fragment
            # - Starts with verb in 3rd person form → no subject (e.g. "Provides...", "Manages...", "Enables...")
            # - Starts with past participle → passive without subject (e.g. "Used for...")
            # A proper sentence must start with a noun/pronoun subject.
            _FRAGMENT_STARTS = re.compile(
                r'^(The|A|An|This|These|Those|Its|Their|'
                r'Provides?|Manages?|Enables?|Handles?|Supports?|Allows?|'
                r'Separates?|Creates?|Returns?|Defines?|Describes?|'
                r'Low-level|Used|Based|Designed|Built|Called)\b'
            )
            if _FRAGMENT_STARTS.match(after_colon):
                # Fragment after colon — keep full original line as-is
                pass
            else:
                # Looks like a proper sentence — use it, discard the label
                block = after_colon

        # Within a block, protect abbreviations before splitting on sentence ends
        protected = re.sub(
            r'\b(' + _ABBREVS + r')\.',
            lambda m: m.group(1) + _ABBREV_MARK,
            block,
            flags=re.IGNORECASE
        )
        # Protect decimal numbers (3.14, 10.5) and version strings (1.8, 2.0)
        protected = re.sub(r'(\d+)\.(\d)', lambda m: m.group(1) + _ABBREV_MARK + m.group(2), protected)
        # Protect namespace patterns like javax.* and jakarta.inject
        protected = re.sub(r'(javax|jakarta|java|org|com)\.([\w*]+)', lambda m: m.group(1) + _ABBREV_MARK + m.group(2), protected)

        # Split on .  !  ? followed by space+capital
        parts = re.split(r'(?<=[.!?])\s+(?=[A-Z"\'])', protected)
        for part in parts:
            # Restore protected dots
            part = part.replace(_ABBREV_MARK, '.')
            part = part.strip()
            # Remove leading punctuation artifacts
            part = re.sub(r'^[.,:;]+\s*', '', part)
            part = part.strip()
            if len(part) >= 15:
                sentences.append(part)

    return sentences


# ── Tokenisation ───────────────────────────────────────────────────────────────

def tokenize(text: str) -> list[str]:
    """Return lowercase alphabetic words, filtered by stop-words."""
    words = re.findall(r'\b[a-zA-Z]{2,}\b', text.lower())
    return [w for w in words if w not in STOP_WORDS]


# ── Scoring ────────────────────────────────────────────────────────────────────

def compute_freq(sentences: list[str]) -> Counter:
    all_words: list[str] = []
    for s in sentences:
        if s.startswith(_HEADING_MARK):
            continue
        all_words.extend(tokenize(s))
    return Counter(all_words)


# ── Low-value sentence patterns (penalised, not deleted) ──────────────────────

# Sentences matching these patterns are penalised in scoring so they are
# chosen last, after all substantive content is covered.
# Using a penalty (multiplier) rather than deletion means they can still appear
# in detailed summaries when there is genuinely nothing better to add.

_LOW_VALUE_PATTERNS = [
    # Tutorial / audience framing
    re.compile(
        r'\b(this tutorial|this guide|this article|this course|this chapter'
        r'|this section|designed for|intended for|beginner|prerequisite'
        r'|prior knowledge|basic understanding|you (will|should|must|need)'
        r'|before (reading|studying|starting)|to (get started|begin))\b',
        re.IGNORECASE,
    ),
    # Career / interview noise
    re.compile(
        r'\b(career|job (interview|opportunity|market|position)|interview question'
        r'|software engineer(ing)? position|hiring|placement|salary'
        r'|essential for career|knowledge of .{0,40} is essential for'
        r'|many job interview|questions about .{0,40} concepts'
        r'|positions include question)\b',
        re.IGNORECASE,
    ),
    # Extremely vague stub sentences (≤ 8 words)
    re.compile(r'^\s*\S+(?:\s+\S+){0,7}\s*[.!?]?\s*$'),  # matched only when ≤ 8 words
]

# Multiplier applied to the raw frequency score when a sentence matches a
# low-value pattern.  0.05 means the sentence competes only when everything
# else has already been selected.
_LOW_VALUE_PENALTY = 0.05


def _is_low_value(sentence: str) -> bool:
    """Return True when a sentence matches any low-value pattern."""
    word_count = len(sentence.split())
    for i, pat in enumerate(_LOW_VALUE_PATTERNS):
        if i == 2:
            # The stub pattern only fires for genuinely short sentences
            if word_count <= 8 and pat.match(sentence):
                return True
        else:
            if pat.search(sentence):
                return True
    return False


# ── Definition / first-sentence boost ─────────────────────────────────────────

# "X is a …" or "X (Y) is …" near the start of a document is almost always
# the most important sentence in educational notes — it defines the subject.
_DEFINITION_PAT = re.compile(
    r'^[A-Z][^.]{0,120}\b(is|are|refers? to|can be defined as|means?)\b',
    re.IGNORECASE,
)
# Boost factor for definition sentences (additive, not multiplicative,
# so it does not overpower a section with many high-freq words).
_DEFINITION_BOOST = 0.25


def score_sentences(sentences: list[str], freq: Counter) -> list[float]:
    """
    Score each sentence. Headings always score -1 (never selected).

    Prose sentences are scored by normalised word frequency, then adjusted:
      - Low-value sentences (tutorial intros, career advice, stub fragments)
        are penalised to 5 % of their raw score so they are selected last.
      - Sentences near the start of the document that match a definition
        pattern get a flat additive bonus so definitions survive short budgets.
      - Position bonus: first sentence of each section gets +0.10 so the
        topic opener is preferred over mid-section detail.
    """
    if not freq:
        return [-1.0 if s.startswith(_HEADING_MARK) else 0.0 for s in sentences]

    max_freq = max(freq.values())

    # Track section boundaries to assign per-section position bonuses.
    # "Section" here = sequence of prose sentences between headings.
    section_first_prose: set[int] = set()
    in_new_section = True
    for i, s in enumerate(sentences):
        if s.startswith(_HEADING_MARK):
            in_new_section = True
        else:
            if in_new_section:
                section_first_prose.add(i)
                in_new_section = False

    # Track the very first prose sentence of the whole document (definition boost)
    first_prose_idx = next(
        (i for i, s in enumerate(sentences) if not s.startswith(_HEADING_MARK)),
        None,
    )

    scores = []
    for i, s in enumerate(sentences):
        if s.startswith(_HEADING_MARK):
            scores.append(-1.0)
            continue

        words = tokenize(s)
        if not words:
            scores.append(0.0)
            continue

        # Base TF-style score (normalised word frequency, averaged)
        raw = sum(freq.get(w, 0) / max_freq for w in words)
        score = raw / len(words)

        # Low-value penalty
        if _is_low_value(s):
            score *= _LOW_VALUE_PENALTY

        # Definition sentence bonus (only for un-penalised sentences)
        else:
            if _DEFINITION_PAT.match(s):
                score += _DEFINITION_BOOST

            # Position bonus: first sentence of each section
            if i in section_first_prose:
                score += 0.10

        scores.append(score)

    return scores


# ── Section-aware proportional selection ──────────────────────────────────────

def _get_sections(sentences: list[str]) -> list[list[int]]:
    """
    Group sentence indices into sections separated by headings.
    Returns a list of groups, each group being a list of prose sentence indices.
    """
    sections: list[list[int]] = []
    current: list[int] = []
    for i, s in enumerate(sentences):
        if s.startswith(_HEADING_MARK):
            if current:
                sections.append(current)
                current = []
        else:
            current.append(i)
    if current:
        sections.append(current)
    return sections if sections else [
        [i for i, s in enumerate(sentences) if not s.startswith(_HEADING_MARK)]
    ]


def select_sentences(sentences: list[str], scores: list[float],
                     min_n: int, max_n: int) -> list[str]:
    """
    Proportional section-aware selection:

    Pre-step: If the highest-scoring definition sentence (matches 'X is a …'
      near doc start, un-penalised) has score > 0.3, pre-select it as an
      anchor so it always appears regardless of section budget.

    1. Split prose sentences into sections (separated by headings).
    2. Mark sections as "low-value" when every sentence in them is low-value
       (e.g. a Prerequisites or Career section). Low-value sections get no
       guaranteed minimum allocation.
    3. Allocate remaining budget proportionally across content sections.
    4. Cap each content section at floor(n * 0.5).
    5. Return selected sentences in original document order.
    """
    sections = _get_sections(sentences)
    prose_count = sum(len(sec) for sec in sections)
    n = min(max_n, max(min_n, max(1, math.ceil(prose_count * 0.45))))
    n = min(n, prose_count)

    # ── Pre-step: anchor the best definition sentence ─────────────────────
    # Look in the first content section only (the document intro).
    # If it contains a high-scoring definition sentence, pre-select it so
    # the proportional algorithm cannot trim it away.
    selected_indices: set[int] = set()

    def _section_is_low_value(sec_indices: list[int]) -> bool:
        return all(_is_low_value(sentences[i]) for i in sec_indices)

    content_sections = [s for s in sections if not _section_is_low_value(s)]
    low_sections     = [s for s in sections if     _section_is_low_value(s)]

    if content_sections:
        first_sec = content_sections[0]
        # Candidate: highest-scoring sentence in the first section that is
        # a definition sentence and is not penalised
        definition_candidates = [
            i for i in first_sec
            if not _is_low_value(sentences[i]) and _DEFINITION_PAT.match(sentences[i])
        ]
        if definition_candidates:
            best_def = max(definition_candidates, key=lambda i: scores[i])
            if scores[best_def] > 0.3:
                selected_indices.add(best_def)

    content_count = sum(len(s) for s in content_sections)
    if content_count == 0:
        content_sections = sections
        low_sections = []
        content_count = prose_count

    # Per-section cap: no content section takes more than half the budget
    per_section_cap = max(1, math.floor(n * 0.5))
    remaining_budget = n - len(selected_indices)

    # Round 1 — proportional allocation across content sections only
    section_alloc: list[int] = []
    for sec in content_sections:
        alloc = max(1, math.floor(remaining_budget * len(sec) / content_count))
        alloc = min(alloc, per_section_cap)
        section_alloc.append(alloc)

    # Trim: total allocation must not exceed remaining_budget
    while sum(section_alloc) > remaining_budget:
        largest_idx = max(range(len(section_alloc)), key=lambda i: section_alloc[i])
        section_alloc[largest_idx] -= 1

    # Round 2 — top-k within each content section (skip pre-selected anchors)
    for sec_indices, alloc in zip(content_sections, section_alloc):
        if alloc <= 0:
            continue
        ranked_in_sec = sorted(
            [i for i in sec_indices if i not in selected_indices],
            key=lambda i: scores[i], reverse=True
        )
        for idx in ranked_in_sec[:alloc]:
            selected_indices.add(idx)

    # Round 3 — fill remaining budget from globally highest remaining sentences
    if len(selected_indices) < n:
        all_prose_indices = [i for i, s in enumerate(sentences) if not s.startswith(_HEADING_MARK)]
        remaining = sorted(
            [i for i in all_prose_indices if i not in selected_indices],
            key=lambda i: scores[i],
            reverse=True,
        )
        for idx in remaining[:n - len(selected_indices)]:
            selected_indices.add(idx)

    filtered_indices = _filter_selected(sentences, selected_indices, scores)
    return [sentences[i] for i in filtered_indices]


def _filter_selected(sentences: list[str], selected_indices: set[int],
                     scores: list[float]) -> list[int]:
    """
    Post-selection quality filter. Takes the already-chosen index set and
    removes two classes of low-quality sentences:

    1. Dangling-pronoun openers ("This …", "These …", "Those …", "It …")
       when the sentence immediately preceding them in the document is NOT
       also selected — the referent is absent, so the sentence is confusing.

    2. Near-duplicate sentences — two sentences that share 3+ significant
       content words (ignoring stop-words) and cover the same main noun.
       Keep the higher-scoring one and drop the other.

    Returns the filtered list of indices in document order.
    """
    ordered = sorted(selected_indices)

    # ── Pass 1: dangling pronouns ──────────────────────────────────
    _DANGLING_STARTERS = re.compile(
        r'^(This|These|Those|It|They|Such)\b', re.IGNORECASE
    )
    selected_set = set(ordered)
    filtered: list[int] = []
    for idx in ordered:
        s = sentences[idx].strip()
        if _DANGLING_STARTERS.match(s):
            # Keep only if the immediately preceding prose sentence is also selected
            prev_prose = idx - 1
            while prev_prose >= 0 and sentences[prev_prose].startswith(_HEADING_MARK):
                prev_prose -= 1
            if prev_prose < 0 or prev_prose not in selected_set:
                continue   # drop — referent not present
        filtered.append(idx)

    # ── Pass 2: near-duplicate sentences ──────────────────────────
    # Two sentences are near-duplicates when their content-word Jaccard
    # similarity is ≥ 0.35 (they share more than a third of their vocabulary)
    # OR when one sentence's content words are a near-subset of another's
    # (one says less than the other about the same topic).
    # Keep the higher-scoring one, drop the other.
    _STOP2 = {
        "a","an","the","and","or","in","on","at","to","for","of","with","by",
        "from","is","are","was","were","be","been","its","it","this","that",
        "also","which","where","when","as","both","all","such","into","has","have",
    }

    def _cwords(s: str) -> set:
        # Match words of 2+ chars AND standalone digits (e.g. "9" from "Jakarta EE 9")
        tokens = re.findall(r'\b[a-zA-Z0-9*]{2,}\b|\b\d+\b', s)
        return {w.lower() for w in tokens if w.lower() not in _STOP2}

    def _similarity(a: set, b: set) -> float:
        if not a or not b:
            return 0.0
        jaccard = len(a & b) / len(a | b)
        # Also treat as duplicate when one set covers ≥ 60% of the smaller set
        smaller, larger = (a, b) if len(a) <= len(b) else (b, a)
        containment = len(smaller & larger) / len(smaller) if smaller else 0.0
        return max(jaccard, containment * 0.7)   # weight containment slightly less

    deduped: list[int] = []
    seen_cw: list[set] = []

    for idx in filtered:
        cw = _cwords(sentences[idx])
        duplicate = False
        for j, prev_cw in enumerate(seen_cw):
            if _similarity(cw, prev_cw) >= 0.35:
                # Keep the higher-scoring (more informative) sentence
                if scores[idx] > scores[deduped[j]]:
                    seen_cw[j] = cw
                    deduped[j] = idx
                duplicate = True
                break
        if not duplicate:
            deduped.append(idx)
            seen_cw.append(cw)

    return deduped


# ── Key points ─────────────────────────────────────────────────────────────────

def extract_key_points(selected: list[str], all_sentences: list[str],
                        cap: int = 8) -> list[str]:
    """
    Build key points from the FULL sentence list, not just the selected summary
    sentences. This keeps key points distinct from the summary.

    Strategy:
    1. Score all prose sentences by length and content richness.
    2. Prefer sentences NOT already in the summary, to maximise diversity.
    3. Fall back to summary sentences if not enough unique ones exist.
    4. Strip leading bullet artifacts, deduplicate, cap.
    """
    # Build a set of normalised summary sentences for dedup
    summary_norms: set[str] = set()
    for s in selected:
        summary_norms.add(re.sub(r'\s+', ' ', s.lower().strip()))

    def _clean(s: str) -> str:
        s = s.strip()
        # Strip leading bullet/dash/marker chars only (not letters mid-word).
        # Handles: "- text", "• text", "* text", "▸ text", "► text"
        # Also handles: "- o text", "o text" (letter-o bullet used in some editors)
        s = re.sub(r'^[-•*▸►]+\s*', '', s).strip()
        # Strip standalone letter-o bullet (only before uppercase/digit)
        s = re.sub(r'^o\s+(?=[A-Z0-9])', '', s).strip()
        return s

    def _norm(s: str) -> str:
        return re.sub(r'\s+', ' ', s.lower().strip())

    # All prose sentences from the full list
    all_prose = [s for s in all_sentences if not s.startswith(_HEADING_MARK)]

    # Prefer sentences with richer content: longer sentences with a period
    def _richness(s: str) -> float:
        words = s.split()
        has_punct = 1.0 if re.search(r'[.!?]$', s) else 0.0
        return len(words) + has_punct * 2

    sorted_prose = sorted(all_prose, key=_richness, reverse=True)

    # ── Near-duplicate helper (same logic as _filter_selected) ────────────
    _KP_STOP = {
        "a","an","the","and","or","in","on","at","to","for","of","with","by",
        "from","is","are","was","were","be","been","its","it","this","that",
        "also","which","where","when","as","both","all","such","into","has","have",
    }

    def _kp_cwords(s: str) -> set:
        tokens = re.findall(r'\b[a-zA-Z]{3,}\b', s)
        return {w.lower() for w in tokens if w.lower() not in _KP_STOP}

    def _kp_similar(a: set, b: set) -> float:
        if not a or not b:
            return 0.0
        jaccard = len(a & b) / len(a | b)
        smaller = min(a, b, key=len)
        larger  = a if smaller is b else b
        containment = len(smaller & larger) / len(smaller) if smaller else 0.0
        return max(jaccard, containment * 0.7)

    seen: set[str] = set()
    seen_cw: list[set] = []
    points: list[str] = []

    def _try_add(cleaned: str) -> bool:
        """Return True and append if the sentence passes all filters."""
        nonlocal seen, seen_cw, points
        if not cleaned:
            return False
        norm = _norm(cleaned)
        if norm in seen or norm in summary_norms:
            return False
        words = cleaned.split()
        if len(words) < 5:
            return False
        # Hard-filter low-value sentences from key points entirely
        # (career advice, tutorial intros, stub fragments are never useful here)
        if _is_low_value(cleaned):
            return False
        # Near-duplicate check against already-accepted key points
        cw = _kp_cwords(cleaned)
        for prev_cw in seen_cw:
            if _kp_similar(cw, prev_cw) >= 0.40:
                return False
        seen.add(norm)
        seen_cw.append(cw)
        points.append(cleaned)
        return True

    # First pass: sentences NOT in summary (adds unique coverage)
    for s in sorted_prose:
        if _try_add(_clean(s)):
            if len(points) >= cap:
                break

    # Second pass: fill remaining slots from summary sentences (if needed)
    if len(points) < cap:
        for s in selected:
            if _try_add(_clean(s)):
                if len(points) >= cap:
                    break

    return points


# ── Important terms ────────────────────────────────────────────────────────────

# Acronyms that must be ALL-CAPS
_ALLCAPS_ACRONYMS = {
    "jpa","ejb","jdbc","jms","jsf","jee","j2ee","orm","sql","xml","json",
    "http","rest","soap","tcp","ip","cpu","ram","jvm","jdk","jre","ioc",
    "aop","mvc","dto","dao","jwt","ssl","tls","aws","gcp","ci","cd","rpc",
    "grpc","uri","url","html","css","dom","spa","ee","jax","jsp","ejb",
    # Added missing acronyms found in real test output
    "cdi","ejb","jaxrs","jaxws","j2se","j2me","jsee","jsse","jaas","jndi",
    "jta","jca","jmx","osgi","wsdl","xsd","rmi","corba","iiop","saml",
}

# Mixed-case display overrides (token → display string)
_DISPLAY_OVERRIDES = {
    "api":        "API",
    "apis":       "APIs",
    "jaxrs":      "JAX-RS",
    "jaxws":      "JAX-WS",
    "rxjava":     "RxJava",
    "microprofile": "MicroProfile",
    "springboot": "Spring Boot",
    "nodejs":     "Node.js",
    "graphql":    "GraphQL",
    "postgresql": "PostgreSQL",
    "mongodb":    "MongoDB",
    "rabbitmq":   "RabbitMQ",
    "activemq":   "ActiveMQ",
    "glassfish":  "GlassFish",
    "wildfly":    "WildFly",
    "javabean":   "JavaBean",
    "javabeans":  "JavaBeans",
    "jakarta":    "Jakarta",
    "microservice": "Microservice",
    "microservices": "Microservices",
    "springframework": "Spring Framework",
    "springmvc":  "Spring MVC",
}

def extract_important_terms(freq: Counter, top_n: int = 12) -> list[str]:
    """
    Return a JSON array of individual meaningful terms (not a concatenated string).

    Strategy:
    - Tokenize on word boundaries from the frequency map.
    - Collapse plural/singular so 'microservice'+'microservices' → one term.
    - Exclude STOP_WORDS and GENERIC_TERMS.
    - Boost acronyms: known acronyms are domain-specific by definition, so they
      get a frequency multiplier so they survive sorting against common words.
    - Apply display overrides for well-known acronyms/brands.
    - Prefer domain-specific, longer tokens over generic short words.
    - Min word length 3.
    - Deduplicate case-insensitively.
    - Return a plain list[str] — always serializes to a JSON array.
    """
    # Collapse plural/singular safely.
    # Avoid stripping endings that produce corrupted roots:
    #   'ss' → "access"→"acces", 'us' → "kubernetes"→"kubernete"
    #   'tes','ces','ves','ies','xes','ses','zes' → various corruptions
    _NO_STRIP = ('tes','ces','ves','ies','xes','ses','zes','hes','ches','ss','us','is')

    collapsed: dict[str, int] = {}
    for word, count in freq.items():
        should_strip = (
            word.endswith('s')
            and len(word) > 5
            and not any(word.endswith(e) for e in _NO_STRIP)
        )
        root = word[:-1] if should_strip else word
        if root not in collapsed or collapsed[root] < count:
            collapsed[root] = count

    # Boost known acronyms so they are not buried by common prose words.
    # A known acronym appearing even once is more domain-relevant than
    # a generic word appearing three times.
    ACRONYM_BOOST = 4  # multiply count by this factor
    boosted: dict[str, int] = {}
    for word, count in collapsed.items():
        if word.lower() in _ALLCAPS_ACRONYMS:
            boosted[word] = count * ACRONYM_BOOST
        else:
            boosted[word] = count

    # Sort by boosted frequency desc, then length desc (prefer specific longer terms)
    sorted_words = sorted(boosted.items(), key=lambda x: (x[1], len(x[0])), reverse=True)

    terms: list[str] = []
    seen_lower: set[str] = set()

    for word, _count in sorted_words:
        lower = word.lower()

        if lower in GENERIC_TERMS:
            continue
        # "EE" alone is too generic; skip standalone 2-letter acronyms that
        # are only meaningful as part of a compound (Java EE, J2EE, etc.)
        if lower in ("ee", "jax", "cd", "ci"):
            continue
        if len(word) < 3:
            continue
        if lower in seen_lower:
            continue
        # Skip if a strictly-longer term that STARTS WITH this word already exists.
        # Use startswith (prefix/root match) not `in` (substring match) so that
        # "java" is NOT dropped because "javascript" exists — they are different terms.
        if any(
            seen.startswith(lower) and len(seen) > len(lower) + 2
            for seen in seen_lower
        ):
            continue
        seen_lower.add(lower)

        # Determine display form
        if lower in _DISPLAY_OVERRIDES:
            display = _DISPLAY_OVERRIDES[lower]
        elif lower in _ALLCAPS_ACRONYMS:
            display = word.upper()
        elif len(word) <= 4 and word.isalpha() and word.isupper():
            display = word.upper()
        else:
            display = word.capitalize()

        # Dedup: skip if we already have the base acronym (api vs apis)
        display_lower = display.lower().rstrip('s')
        if any(t.lower().rstrip('s') == display_lower for t in terms):
            continue

        terms.append(display)
        if len(terms) >= top_n:
            break

    return terms  # always a list[str] → JSON array


# ── Reading time ───────────────────────────────────────────────────────────────

def estimate_reading_time(text: str) -> int:
    return max(1, round(len(text.split()) / WORDS_PER_SECOND))


# ── Views ──────────────────────────────────────────────────────────────────────

@require_http_methods(["GET"])
def health(request):
    """GET /api/health/"""
    return JsonResponse({
        "status":  "ok",
        "service": "AI StudyMate Pro API",
        "version": "1.1",
    })


@require_http_methods(["POST"])
def summarize(request):
    """POST /api/summarize/"""

    # Parse body
    try:
        body = json.loads(request.body)
    except (json.JSONDecodeError, UnicodeDecodeError):
        return JsonResponse(
            {"error": "Invalid JSON. Send fields: text, subject, length."},
            status=400,
        )

    text    = body.get("text", "")
    subject = body.get("subject", "Other")
    length  = body.get("length", "medium")

    if not isinstance(text, str):
        return JsonResponse({"error": "'text' must be a string."}, status=400)

    text = clean_text(text)

    if len(text) < MIN_INPUT_CHARS:
        return JsonResponse(
            {"error": f"Text is too short. Please provide at least {MIN_INPUT_CHARS} characters."},
            status=422,
        )
    if len(text) > MAX_INPUT_CHARS:
        return JsonResponse(
            {"error": f"Text is too long. Maximum is {MAX_INPUT_CHARS:,} characters."},
            status=422,
        )
    if length not in LENGTH_MAP:
        length = "medium"

    # Process
    all_sentences = split_into_sentences(text)
    prose = [s for s in all_sentences if not s.startswith(_HEADING_MARK)]

    # Edge case: only headings or very short prose
    if len(prose) < 2:
        prose_text = text
        terms = extract_important_terms(compute_freq(all_sentences))
        return JsonResponse({
            "summary":              prose_text,
            "key_points":           [prose_text[:200]] if prose_text else [],
            "important_terms":      terms,
            "original_chars":       len(text),
            "summary_chars":        len(prose_text),
            "reading_time_seconds": estimate_reading_time(prose_text),
        })

    freq     = compute_freq(all_sentences)
    scores   = score_sentences(all_sentences, freq)
    min_n, max_n = LENGTH_MAP[length]
    selected = select_sentences(all_sentences, scores, min_n, max_n)

    # Build individual sentences with proper terminal punctuation
    summary_sentences: list[str] = []
    for s in selected:
        s = s.strip()
        if s and not re.search(r'[.!?]$', s):
            s += '.'
        if s:
            summary_sentences.append(s)

    # summary string kept for backward compat (copy/download)
    summary = ' '.join(summary_sentences)

    # key points cap: 6 for short, 8 for medium, 12 for detailed
    kp_cap = {"short": 6, "medium": 8, "detailed": 12}.get(length, 8)
    key_points      = extract_key_points(selected, all_sentences, cap=kp_cap)
    important_terms = extract_important_terms(freq)

    return JsonResponse({
        "summary":              summary,
        "summary_sentences":    summary_sentences,   # list for paragraph rendering
        "key_points":           key_points,
        "important_terms":      important_terms,
        "original_chars":       len(text),
        "summary_chars":        len(summary),
        "reading_time_seconds": estimate_reading_time(summary),
    })


# ══════════════════════════════════════════════════════════════════════════════
# Quiz Generator — all logic below, no database required
# ══════════════════════════════════════════════════════════════════════════════

import random

# ── Quiz constants ─────────────────────────────────────────────────────────────

QUIZ_MAX_INPUT   = 20_000
QUIZ_MIN_INPUT   = 80    # need at least a few sentences
QUIZ_COUNTS      = {5, 10, 15}
QUIZ_DIFFICULTIES = {"easy", "medium", "hard"}
QUIZ_TYPES       = {"mcq", "truefalse", "mixed"}

# Minimum prose sentences needed before we can safely generate questions
_MIN_PROSE_FOR_MCQ      = 4   # need enough for distractors
_MIN_PROSE_FOR_TF       = 2
_DISTRACTOR_POOL_RATIO  = 3   # need at least 3× as many terms as options


# ── Sentence quality gate for quiz sources ─────────────────────────────────────
#
# A sentence is usable as a quiz source only if:
#   • It is a complete declarative sentence (has a verb, ends with punctuation)
#   • It is long enough to contain a testable fact (≥ 8 words)
#   • It does not start with a dangling pronoun (referent unknown)
#   • It is not a low-value sentence (tutorial intro, career advice)

_UNUSABLE_STARTERS = re.compile(
    r'^(This|These|Those|It|They|Such|Here|There|'
    r'Note|See|Refer|Above|Below|As (shown|mentioned|discussed|noted))\b',
    re.IGNORECASE,
)

def _is_quiz_worthy(sentence: str) -> bool:
    """Return True if this sentence can be used as a quiz question source."""
    s = sentence.strip()
    if len(s.split()) < 8:
        return False
    if not re.search(r'[.!?]$', s):
        return False
    if _UNUSABLE_STARTERS.match(s):
        return False
    if _is_low_value(s):
        return False
    # Must contain at least one verb-like word (simple heuristic)
    lower = s.lower()
    verb_indicators = (
        " is ", " are ", " was ", " were ", " has ", " have ", " had ",
        " can ", " will ", " does ", " do ", " provides ", " uses ",
        " allows ", " enables ", " requires ", " consists ", " contains ",
        " manages ", " controls ", " stores ", " creates ", " performs ",
        " represents ", " defines ", " refers ", " means ", " called ",
        " known ", " used ", " designed ", " built ", " runs ",
    )
    if not any(v in lower for v in verb_indicators):
        return False
    return True


# ── Sentence-to-question conversion helpers ───────────────────────────────────

def _cap_phrase(text: str, max_chars: int = 80) -> str:
    """
    Trim a phrase to at most max_chars characters, breaking at a word boundary.
    Also strips trailing coordinating conjunctions (and, or, but, nor) and
    trailing punctuation that would leave a dangling clause.
    """
    if len(text) <= max_chars:
        return text.rstrip(',;: ')
    trimmed = text[:max_chars].rsplit(' ', 1)[0]
    # Strip trailing conjunctions that produce dangling phrases
    trimmed = re.sub(r'\s+\b(and|or|but|nor|by|with|as|of|to|for|in|on|at)\s*$',
                     '', trimmed, flags=re.IGNORECASE)
    return trimmed.rstrip(',;: ')


def _extract_answer_from_sentence(sentence: str) -> tuple[str, str]:
    """
    Pull the best testable answer from a sentence.

    Returns (answer_text, question_text) where question_text has the
    answer replaced with a blank.

    Strategy:
    1. Find noun phrases after "is/are/was/were/refers to/means/called/known as"
       — these are predicate-noun definitions, the highest-quality quiz targets.
    2. Find verb-object phrases ("manages X", "provides X", etc.).
    3. Fall back: blank the last meaningful chunk of words.

    Key correctness rules:
    - The blank replaces only the ANSWER portion (group 1), never the verb.
      We reconstruct the question stem from the part of the sentence BEFORE the
      verb + the blank, so no characters from the verb leak into the blank token.
    - Answer length is capped at 100 chars to avoid truncated display, but we
      keep as much of the phrase as the regex captures up to that cap.
    - Question text always ends with '?'.
    """
    s = sentence.rstrip('.!?').strip()

    # ── Pattern 1: predicate-noun definition ─────────────────────────────────
    # Matches: "X is [a/an/the] ANSWER"
    # Captures: group(1)=verb phrase  group(2)=optional article  group(3)=answer
    # We keep the verb in the stem and blank only the answer.
    m = re.search(
        r'(\b(?:is|are|was|were|refers?\s+to|means?|called|known\s+as)\s+'
        r'(?:a\s+|an\s+|the\s+)?)'
        r'([^,.;:]{6,120})',
        s, re.IGNORECASE
    )
    if m:
        verb_part  = m.group(1)          # e.g. "is a "  — kept in stem
        answer_raw = m.group(2).strip().rstrip('.!?,;:')
        answer_raw = _clean_trailing_stops(answer_raw)
        # Cap answer at 100 chars; break at the last space to avoid mid-word cut
        if len(answer_raw) > 80:
            answer_raw = _cap_phrase(answer_raw)
            answer_raw = _clean_trailing_stops(answer_raw)
        if len(answer_raw) >= 4:
            # Build stem: everything up to (but not including) the answer
            stem_end = m.start(2)          # index where the answer begins in s
            stem = s[:stem_end].rstrip()
            question = stem + ' ___?'
            return answer_raw, question

    # ── Pattern 2: verb–object phrase ────────────────────────────────────────
    # Matches: "X manages/uses/provides/… ANSWER"
    m2 = re.search(
        r'(\b(?:manages?|uses?|controls?|stores?|creates?|provides?|handles?|'
        r'enables?|supports?|performs?|contains?|consists?\s+of|'
        r'converts?|produces?|absorbs?|allows?|requires?)\s+)'
        r'([^,.;:]{4,100})',
        s, re.IGNORECASE
    )
    if m2:
        answer_raw = m2.group(2).strip().rstrip('.!?,;:')
        answer_raw = _clean_trailing_stops(answer_raw)
        if len(answer_raw) > 80:
            answer_raw = _cap_phrase(answer_raw)
            answer_raw = _clean_trailing_stops(answer_raw)
        if len(answer_raw) >= 4:
            stem_end = m2.start(2)
            stem = s[:stem_end].rstrip()
            question = stem + ' ___?'
            return answer_raw, question

    # ── Fallback: blank the last meaningful chunk ─────────────────────────────
    words = s.split()
    if len(words) >= 6:
        cut = max(2, min(5, len(words) // 3))
        answer = ' '.join(words[-cut:]).rstrip('.!?,;:')
        question = ' '.join(words[:-cut]) + ' ___?'
        return answer, question

    return s, "What does this describe?"


# ── Distractor quality helpers ────────────────────────────────────────────────

def _meaningful_word_count(text: str) -> int:
    """Count words in text that are not stop words and are >= 3 characters long."""
    words = re.findall(r'\b[a-zA-Z]{3,}\b', text.lower())
    return sum(1 for w in words if w not in STOP_WORDS)


def _similarity_ratio(a: str, b: str) -> float:
    """Return SequenceMatcher ratio between two strings (case-insensitive)."""
    return SequenceMatcher(None, a.lower(), b.lower()).ratio()


# Trailing stop words to strip from answer/distractor endings
_TRAILING_STOP_PAT = re.compile(
    r'\s+\b(and|or|but|nor|by|with|as|of|to|for|in|on|at|a|an|the)\s*$',
    re.IGNORECASE,
)


def _clean_trailing_stops(text: str) -> str:
    """Strip trailing prepositions/conjunctions/articles from a phrase."""
    result = _TRAILING_STOP_PAT.sub('', text).rstrip(',;: ')
    # Repeat in case multiple trailing stops were stacked
    while True:
        cleaned = _TRAILING_STOP_PAT.sub('', result).rstrip(',;: ')
        if cleaned == result:
            break
        result = cleaned
    return result


# ── Distractor generation ─────────────────────────────────────────────────────

def _build_distractor_pool(
    all_sentences: list[str],
    freq: Counter,
    correct_answer: str,
    difficulty: str,
    question_text: str = "",          # question stem for relevance ranking
    used_distractors: dict | set | None = None,  # cross-question reservation (phrase->count or set)
) -> list[str]:
    """
    Build a pool of plausible-but-wrong answer options.

    Easy:   simple short phrases from other sentences, clearly different
    Medium: noun phrases from other sentences, moderately similar in style
    Hard:   phrases from the same semantic neighbourhood as the correct answer
            (words that co-occur with the same document terms)

    We never claim these are facts — they are distractors drawn from the
    document vocabulary and partial sentences.

    Quality rules applied here:
    - Answers longer than 80 chars are trimmed at the last word boundary
      (avoids truncated mid-word strings in options).
    - The term-based fallback only uses multi-word descriptions, not bare
      single terms, so all options look stylistically similar to the correct answer.
    """
    correct_lower = correct_answer.lower()
    correct_words = set(re.findall(r'\b[a-z]{3,}\b', correct_lower)) - STOP_WORDS

    pool: list[str] = []
    seen_lower: set[str] = set()
    # Store full lowercase string (not [:60]) so the membership check and the
    # similarity gate operate on the same representation (finding 1 fix).
    seen_lower.add(correct_lower)

    # Cross-question reservation: distractors already chosen by earlier questions
    # in this quiz run are tracked here so later questions prefer fresh candidates.
    # Can be a dict[str, int] (phrase -> use count) or set[str] for backward compat.
    _reserved: dict[str, int] = {}
    if used_distractors is not None:
        if isinstance(used_distractors, dict):
            # Shallow copy so that any future write to _reserved inside this
            # function cannot corrupt the caller's cross-quiz reservation dict.
            # Reads are still O(1) — only one dict allocation per question.
            _reserved = dict(used_distractors)
        else:
            _reserved = {k: 1 for k in used_distractors}

    # Pre-compute question stem words for the hard relevance filter (applied in
    # the main loop; only when question_text is provided).
    _q_words_hard: set[str] = set()
    if question_text:
        _q_words_hard = set(re.findall(r'\b[a-z]{3,}\b', question_text.lower())) - STOP_WORDS

    # ── Shared difficulty-overlap filter (finding 2 fix) ──────────────────────
    # Called from both the main loop and the supplement loop so difficulty
    # semantics are consistent regardless of pool size.
    def _fails_difficulty_overlap(cand_words_set: set) -> bool:
        overlap = len(correct_words & cand_words_set) / max(1, len(correct_words | cand_words_set))
        if difficulty == "easy" and overlap > 0.4:
            return True
        if difficulty == "hard" and overlap < 0.05:
            return True
        return False

    # ── Two buckets: preferred (not yet used) and fallback (already used) ─────
    preferred: list[str] = []
    fallback:  list[str] = []

    # Collect candidate phrases from prose sentences
    for s in all_sentences:
        if s.startswith(_HEADING_MARK):
            continue
        if not _is_quiz_worthy(s):
            continue

        # Extract the predicate / object of this sentence
        candidate, _ = _extract_answer_from_sentence(s)
        candidate = candidate.strip().rstrip('.!?,;:')
        candidate = _clean_trailing_stops(candidate)

        # Cap at 80 chars at a word boundary to match the correct answer style
        if len(candidate) > 80:
            candidate = _cap_phrase(candidate)
            candidate = _clean_trailing_stops(candidate)

        # Quality gate: require at least 3 meaningful (non-stop-word) words
        if _meaningful_word_count(candidate) < 3:
            continue

        # Filter: not too short
        if len(candidate) < 6:
            continue
        # Use full lowercase string for dedup (finding 1 fix: was [:60])
        cand_lower = candidate.lower()
        if cand_lower in seen_lower:
            continue

        # Reject if too similar to the correct answer (replaces old startswith check)
        if _similarity_ratio(candidate, correct_answer) > 0.85:
            continue

        # Difficulty-aware overlap filter
        cand_words = set(re.findall(r'\b[a-z]{3,}\b', cand_lower)) - STOP_WORDS
        if _fails_difficulty_overlap(cand_words):
            continue

        # Hard relevance filter: candidate must share at least one significant
        # keyword with either the question stem or the correct answer.
        # Only applied when question_text is provided (existing callers without
        # question_text are unaffected).
        if _q_words_hard:
            # Reject candidates with zero keyword overlap with both the question
            # stem and the correct answer. "database" alone counts as overlap for
            # DBMS material, so this filter only removes truly unrelated content.
            shared_with_question = cand_words & _q_words_hard
            shared_with_answer   = cand_words & correct_words
            if not shared_with_question and not shared_with_answer:
                continue  # REJECT: no keyword overlap with question or answer

        seen_lower.add(cand_lower)
        # Route into preferred bucket (not yet used) or fallback bucket (already used)
        if cand_lower in _reserved:
            fallback.append(candidate)
        else:
            preferred.append(candidate)

    # Merge: preferred candidates first, fallback (already-used) at the end.
    # Relevance ranking is applied within each group below.
    pool = preferred + fallback

    # ── Supplement with sentence-derived phrases if pool is thin ─────────────
    # Always initialise both supplement lists so they are defined when the
    # relevance-ranking block references supp_preferred below (Finding 3 fix).
    supp_preferred: list[str] = []
    supp_fallback:  list[str] = []
    if len(pool) < 6:
        for s in all_sentences:
            if s.startswith(_HEADING_MARK):
                continue
            if not _is_quiz_worthy(s):
                continue
            candidate, _ = _extract_answer_from_sentence(s)
            candidate = candidate.strip().rstrip('.!?,;:')
            candidate = _clean_trailing_stops(candidate)
            if len(candidate) > 80:
                candidate = _cap_phrase(candidate)
                candidate = _clean_trailing_stops(candidate)

            # Quality gate in supplement loop too
            if _meaningful_word_count(candidate) < 3:
                continue
            if len(candidate) < 8:
                continue
            # Use full lowercase string for dedup (finding 1 fix: was [:60])
            cand_lower = candidate.lower()
            if cand_lower in seen_lower:
                continue
            if _similarity_ratio(candidate, correct_answer) > 0.85:
                continue
            cand_words = set(re.findall(r'\b[a-z]{3,}\b', cand_lower)) - STOP_WORDS
            # Apply difficulty overlap filter in supplement loop too (finding 2 fix)
            if _fails_difficulty_overlap(cand_words):
                continue
            # Hard relevance filter in supplement loop too — same logic as main loop
            if _q_words_hard:
                shared_with_question = cand_words & _q_words_hard
                shared_with_answer   = cand_words & correct_words
                if not shared_with_question and not shared_with_answer:
                    continue  # REJECT from supplement: no topical connection
            too_similar = any(
                len(cand_words & set(re.findall(r'\b[a-z]{3,}\b', p.lower())) - STOP_WORDS)
                / max(1, len(cand_words | (set(re.findall(r'\b[a-z]{3,}\b', p.lower())) - STOP_WORDS)))
                > 0.55
                for p in pool
            )
            if not too_similar:
                seen_lower.add(cand_lower)
                if cand_lower in _reserved:
                    supp_fallback.append(candidate)
                else:
                    supp_preferred.append(candidate)
            if len(pool) + len(supp_preferred) + len(supp_fallback) >= 12:
                break
        pool = preferred + supp_preferred + fallback + supp_fallback

    # ── Per-question relevance ranking (within each bucket) ──────────────────
    # Sort pool by keyword overlap with the question stem so topically relevant
    # distractors are selected first.  We re-sort the full pool but the
    # preferred/fallback split is already baked in via the bucket merge order
    # (preferred candidates will dominate the top of the sorted list because
    # they also tend to have higher relevance — this is the intended behaviour).
    if question_text:
        q_words = set(re.findall(r'\b[a-z]{3,}\b', question_text.lower())) - STOP_WORDS

        def _relevance(candidate: str) -> float:
            c_words = set(re.findall(r'\b[a-z]{3,}\b', candidate.lower())) - STOP_WORDS
            if not q_words or not c_words:
                return 0.0
            return len(q_words & c_words) / max(1, len(q_words | c_words))

        # Sort each bucket independently so reserved candidates never displace
        # fresh ones even if they happen to have a higher relevance score.
        # pref_set includes both preferred and supp_preferred (both are "not yet used")
        # so supp_preferred candidates are correctly sorted by relevance, not by use-count.
        pref_set = {c.lower() for c in preferred} | {c.lower() for c in supp_preferred}
        pref_part = [c for c in pool if c.lower() in pref_set]
        fall_part = [c for c in pool if c.lower() not in pref_set]
        pref_part.sort(key=_relevance, reverse=True)
        # Fallback sorted by usage count (ascending) then relevance (descending)
        # so least-used reserved candidates are preferred over frequently reused ones.
        fall_part.sort(key=lambda c: (_reserved.get(c.lower(), 0), -_relevance(c)))
        pool = pref_part + fall_part
    else:
        # No question_text — sort fallback by usage count only
        if _reserved:
            pref_set = {c.lower() for c in preferred} | {c.lower() for c in supp_preferred}
            pref_part = [c for c in pool if c.lower() in pref_set]
            fall_part = [c for c in pool if c.lower() not in pref_set]
            fall_part.sort(key=lambda c: _reserved.get(c.lower(), 0))
            pool = pref_part + fall_part

    return pool


# ── MCQ builder ───────────────────────────────────────────────────────────────

def _build_mcq(
    sentence: str,
    all_sentences: list[str],
    freq: Counter,
    difficulty: str,
    used_questions: set[str],
    used_distractors: dict | set | None = None,  # cross-question reservation (phrase->count or set)
) -> dict | None:
    """
    Build one multiple-choice question from a source sentence.
    Returns None if a valid question cannot be constructed.
    """
    answer, question_text = _extract_answer_from_sentence(sentence)
    if not answer or len(answer) < 4:
        return None

    # Cap correct answer at 80 chars using the same helper
    if len(answer) > 80:
        answer = _cap_phrase(answer)
    answer = _clean_trailing_stops(answer)
    if len(answer) < 4:
        return None

    # Reject answers with fewer than 3 meaningful words — they produce
    # low-quality distractors and weak question stems.
    if _meaningful_word_count(answer) < 3:
        return None

    # Deduplicate across questions
    q_key = re.sub(r'\s+', ' ', question_text.lower().strip())[:80]
    if q_key in used_questions:
        return None
    used_questions.add(q_key)
    # Also register the source sentence so it can't be reused as a TF question
    src_key = re.sub(r'\s+', ' ', sentence.lower().strip())[:80]
    used_questions.add(src_key)

    # Build a per-question distractor pool filtered against THIS question's answer
    distractor_pool = _build_distractor_pool(
        all_sentences, freq,
        correct_answer=answer,
        difficulty=difficulty,
        question_text=question_text,
        used_distractors=used_distractors,
    )

    # Pick 3 distractors that are different from the correct answer
    correct_lower = answer.lower()
    distractors: list[str] = []
    for d in distractor_pool:
        d_capped = _cap_phrase(d) if len(d) > 80 else d
        d_capped = _clean_trailing_stops(d_capped)
        if not d_capped or len(d_capped) < 4:
            continue
        d_lower = d_capped.lower()
        if d_lower == correct_lower:
            continue
        # Reject if too similar to the correct answer
        if _similarity_ratio(d_capped, answer) > 0.85:
            continue
        # Also reject if too similar to an already-chosen distractor
        if any(_similarity_ratio(d_capped, existing) > 0.85 for existing in distractors):
            continue
        distractors.append(d_capped)
        if len(distractors) == 3:
            break

    if len(distractors) < 3:
        return None  # not enough distractors — skip rather than invent

    # Register distractors in the cross-question reservation set so later
    # questions in this quiz run prefer fresher candidates.
    if used_distractors is not None:
        for d in distractors:
            key = d.strip().lower()
            if isinstance(used_distractors, dict):
                used_distractors[key] = used_distractors.get(key, 0) + 1
            else:
                used_distractors.add(key)

    # Shuffle options so correct answer is not always in the same position
    options = [answer] + distractors

    # Deduplicate options within this question (case-insensitive, strip whitespace)
    seen_opts: set[str] = set()
    unique_options: list[str] = []
    for opt in options:
        norm = opt.strip().lower()
        if norm not in seen_opts:
            seen_opts.add(norm)
            unique_options.append(opt)
    options = unique_options

    # Ensure the correct answer is still present after dedup
    if answer not in options:
        return None

    # Need at least 4 options (1 correct + 3 distractors) for a usable MCQ
    if len(options) < 4:
        return None

    random.shuffle(options)
    correct_index = options.index(answer)

    return {
        "type":           "mcq",
        "question":       question_text,
        "source":         sentence.strip(),
        "options":        options,
        "correct_index":  correct_index,
        "correct_answer": answer,
        "explanation":    f'According to the notes: "{sentence.strip()}"',
    }


# ── True/False builder ────────────────────────────────────────────────────────

# Words we can swap to create a false statement (antonym-style swaps)
_TF_SWAPS = [
    ("increases",  "decreases"),  ("decrease",   "increase"),
    ("faster",     "slower"),     ("slower",      "faster"),
    ("larger",     "smaller"),    ("smaller",     "larger"),
    ("more",       "fewer"),      ("fewer",       "more"),
    ("first",      "last"),       ("last",        "first"),
    ("always",     "never"),      ("never",       "always"),
    ("all",        "none"),       ("none",        "all"),
    ("primary",    "secondary"),  ("secondary",   "primary"),
    ("before",     "after"),      ("after",       "before"),
    ("enables",    "prevents"),   ("prevents",    "enables"),
    ("stores",     "discards"),   ("discards",    "stores"),
    ("creates",    "deletes"),    ("deletes",     "creates"),
    ("open",       "closed"),     ("closed",      "open"),
    ("true",       "false"),      ("false",       "true"),
    ("synchronous","asynchronous"),("asynchronous","synchronous"),
    ("stateful",   "stateless"),  ("stateless",   "stateful"),
    ("local",      "remote"),     ("remote",      "local"),
    ("static",     "dynamic"),    ("dynamic",     "static"),
    ("high",       "low"),        ("low",         "high"),
    ("input",      "output"),     ("output",      "input"),
]

# Key-term swaps: replace a proper noun/term with another from the document
def _mutate_sentence(sentence: str, all_terms: list[str]) -> tuple[str, bool]:
    """
    Try to mutate the sentence to make it false.
    Returns (possibly_mutated_sentence, was_mutated).
    Priority: antonym swap > term swap.
    """
    s = sentence

    # Attempt antonym swap
    for original, replacement in _TF_SWAPS:
        pattern = r'\b' + re.escape(original) + r'\b'
        new_s = re.sub(pattern, replacement, s, count=1, flags=re.IGNORECASE)
        if new_s != s:
            return new_s, True

    # Attempt term swap — replace one important term with a different one
    if len(all_terms) >= 2:
        for term in all_terms:
            if term.lower() in s.lower() and len(term) >= 4:
                # Find a different term of similar length and same general domain.
                # "Same domain" heuristic: both terms must have at least one
                # character in common with the sentence's content words (avoids
                # swapping in terms from an unrelated part of a mixed-topic input).
                sent_words = set(re.findall(r'\b[a-z]{3,}\b', s.lower())) - STOP_WORDS
                replacements = [
                    t for t in all_terms
                    if t.lower() != term.lower()
                    and t.lower() not in s.lower()
                    and abs(len(t) - len(term)) <= 12
                    # At least one word in the replacement touches the sentence vocabulary
                    and bool(set(re.findall(r'\b[a-z]{3,}\b', t.lower())) & sent_words)
                ]
                if replacements:
                    swap_in = random.choice(replacements)
                    new_s = re.sub(
                        r'\b' + re.escape(term) + r'\b',
                        swap_in, s, count=1, flags=re.IGNORECASE
                    )
                    if new_s != s:
                        return new_s, True

    return s, False  # couldn't mutate — use as-is (True statement)


def _build_tf(
    sentence: str,
    all_terms: list[str],
    difficulty: str,
    used_questions: set[str],
    force_true: bool = False,
) -> dict | None:
    """
    Build one True/False question from a source sentence.
    Alternates between true and false statements for variety.
    """
    # For easy: use original (true) statements more often
    # For hard:  mutate more often (false statements harder to spot)
    if force_true:
        is_true = True
        display_sentence = sentence.strip()
    else:
        # Decide based on difficulty: easy=70% true, medium=50%, hard=30%
        true_probability = {"easy": 0.70, "medium": 0.50, "hard": 0.30}.get(difficulty, 0.50)
        is_true = random.random() < true_probability

    if is_true:
        display_sentence = sentence.strip()
    else:
        display_sentence, was_mutated = _mutate_sentence(sentence, all_terms)
        if not was_mutated:
            # Couldn't make it false — use as true
            is_true = True
            display_sentence = sentence.strip()

    # Deduplicate
    # Register both the display sentence and the original source so neither
    # can appear again as an MCQ or another TF question.
    q_key = re.sub(r'\s+', ' ', display_sentence.lower().strip())[:80]
    src_key = re.sub(r'\s+', ' ', sentence.lower().strip())[:80]
    if q_key in used_questions or src_key in used_questions:
        return None
    used_questions.add(q_key)
    used_questions.add(src_key)

    correct_label = "True" if is_true else "False"
    explanation = (
        f'This statement is {"correct" if is_true else "incorrect"}. '
        f'The notes state: "{sentence.strip()}"'
    )

    return {
        "type":           "truefalse",
        "question":       display_sentence,
        "source":         sentence.strip(),
        "options":        ["True", "False"],
        "correct_index":  0 if is_true else 1,
        "correct_answer": correct_label,
        "explanation":    explanation,
    }


# ── Main quiz assembly ────────────────────────────────────────────────────────

def _assemble_quiz(
    all_sentences: list[str],
    freq:          Counter,
    scores:        list[float],
    quiz_type:     str,
    count:         int,
    difficulty:    str,
) -> tuple[list[dict], list[str]]:
    """
    Build a list of quiz questions and a list of warning strings.
    Returns (questions, warnings).
    """
    warnings: list[str] = []

    # Select source sentences: quiz-worthy, sorted by score descending
    source_candidates = [
        (i, s) for i, s in enumerate(all_sentences)
        if not s.startswith(_HEADING_MARK) and _is_quiz_worthy(s)
    ]
    source_candidates.sort(key=lambda x: scores[x[0]], reverse=True)
    source_sentences = [s for _, s in source_candidates]

    # Gather all important terms for distractors / TF swaps
    all_terms_display = extract_important_terms(freq, top_n=30)

    if len(source_sentences) < _MIN_PROSE_FOR_TF:
        return [], ["Not enough usable sentences in the notes to generate questions. "
                    "Please paste more detailed notes."]

    # Determine split between MCQ and TF
    if quiz_type == "mcq":
        mcq_target = count
        tf_target  = 0
    elif quiz_type == "truefalse":
        mcq_target = 0
        tf_target  = count
    else:  # mixed
        mcq_target = count // 2
        tf_target  = count - mcq_target

    # Check if MCQ is feasible
    if mcq_target > 0 and len(source_sentences) < _MIN_PROSE_FOR_MCQ:
        if quiz_type == "mcq":
            # Fall back to all TF
            warnings.append(
                f"Not enough distinct sentences for multiple-choice questions "
                f"(need at least {_MIN_PROSE_FOR_MCQ}). Generated True/False instead."
            )
            tf_target  = count
            mcq_target = 0
        else:
            # Mixed: reduce MCQ portion
            warnings.append("Some multiple-choice questions were replaced with True/False "
                             "because the notes don't have enough distinct sentences.")
            tf_target += mcq_target
            mcq_target = 0

    used_questions: set[str] = set()
    questions: list[dict] = []

    # ── Build MCQ questions ────────────────────────────────────────────────────
    if mcq_target > 0:
        used_distractors: dict[str, int] = {}  # cross-question reservation (phrase -> use count)
        for sentence in source_sentences:
            if len(questions) >= mcq_target:
                break
            q = _build_mcq(sentence, all_sentences, freq, difficulty, used_questions,
                           used_distractors=used_distractors)
            if q:
                questions.append(q)

        if len(questions) < mcq_target:
            shortfall = mcq_target - len(questions)
            warnings.append(
                f"Could only generate {len(questions)} of {mcq_target} requested "
                f"multiple-choice questions from the available notes. "
                f"Adding {shortfall} True/False question(s) to reach the target."
            )
            tf_target += shortfall

    # ── Build True/False questions ────────────────────────────────────────────
    tf_questions: list[dict] = []
    if tf_target > 0:
        # Alternate true/false for variety — start with true
        force_true_toggle = True
        for sentence in source_sentences:
            if len(tf_questions) >= tf_target:
                break
            q = _build_tf(sentence, all_terms_display, difficulty, used_questions,
                          force_true=force_true_toggle)
            if q:
                tf_questions.append(q)
                force_true_toggle = not force_true_toggle

        if len(tf_questions) < tf_target:
            warnings.append(
                f"Could only generate {len(tf_questions)} of {tf_target} "
                f"True/False questions from the available notes."
            )

    # Interleave MCQ and TF for a natural mixed feel
    if quiz_type == "mixed" and questions and tf_questions:
        merged = []
        qi, ti = 0, 0
        while qi < len(questions) or ti < len(tf_questions):
            if qi < len(questions):
                merged.append(questions[qi]); qi += 1
            if ti < len(tf_questions):
                merged.append(tf_questions[ti]); ti += 1
        questions = merged
    else:
        questions = questions + tf_questions

    # Final shuffle for harder difficulty
    if difficulty == "hard":
        random.shuffle(questions)

    return questions[:count], warnings


# ── Quiz view ─────────────────────────────────────────────────────────────────

@require_http_methods(["POST"])
def generate_quiz(request):
    """
    POST /api/quiz/
    Body: { text, count, difficulty, quiz_type }
    Response: { questions: [...], warnings: [...], total: int }
    """
    try:
        body = json.loads(request.body)
    except (json.JSONDecodeError, UnicodeDecodeError):
        return JsonResponse({"error": "Invalid JSON. Expected: text, count, difficulty, quiz_type."}, status=400)

    text       = body.get("text", "")
    count      = body.get("count", 5)
    difficulty = body.get("difficulty", "medium")
    quiz_type  = body.get("quiz_type", "mixed")

    # ── Validate inputs ───────────────────────────────────────────────────────
    if not isinstance(text, str):
        return JsonResponse({"error": "'text' must be a string."}, status=400)

    text = clean_text(text)

    if len(text) < QUIZ_MIN_INPUT:
        return JsonResponse(
            {"error": f"Notes are too short (minimum {QUIZ_MIN_INPUT} characters). "
                      "Please paste more detailed study material."},
            status=422,
        )
    if len(text) > QUIZ_MAX_INPUT:
        return JsonResponse(
            {"error": f"Notes are too long (maximum {QUIZ_MAX_INPUT:,} characters)."},
            status=422,
        )

    if not isinstance(count, int) or count not in QUIZ_COUNTS:
        count = 5

    if difficulty not in QUIZ_DIFFICULTIES:
        difficulty = "medium"

    if quiz_type not in QUIZ_TYPES:
        quiz_type = "mixed"

    # ── NLP pipeline (reuses summarizer utilities) ────────────────────────────
    all_sentences = split_into_sentences(text)
    freq          = compute_freq(all_sentences)
    scores        = score_sentences(all_sentences, freq)

    # ── Generate questions ────────────────────────────────────────────────────
    questions, warnings = _assemble_quiz(
        all_sentences, freq, scores,
        quiz_type=quiz_type,
        count=count,
        difficulty=difficulty,
    )

    if not questions:
        return JsonResponse(
            {"error": warnings[0] if warnings else
                      "Could not generate questions from the provided notes. "
                      "Try pasting more detailed notes with complete sentences."},
            status=422,
        )

    return JsonResponse({
        "questions": questions,
        "warnings":  warnings,
        "total":     len(questions),
        "difficulty": difficulty,
        "quiz_type":  quiz_type,
    })


# ══════════════════════════════════════════════════════════════════════════════
# Notes Management API
# ══════════════════════════════════════════════════════════════════════════════

from .models import Note

# Subjects that the frontend allows — mirrors Note.SUBJECT_CHOICES
_VALID_SUBJECTS = {
    "Computer Networks", "Operating Systems", "DBMS", "Java",
    "Web Development", "Mathematics", "Physics", "Chemistry",
    "Biology", "History", "Other",
}


def _note_to_dict(note: Note, include_content: bool = True) -> dict:
    """Serialise a Note to a plain dict for JSON responses."""
    d = {
        "id":      note.pk,
        "title":   note.title,
        "subject": note.subject,
        "created": note.created.isoformat(),
        "updated": note.updated.isoformat(),
    }
    if include_content:
        d["content"] = note.content
    else:
        # Send a short preview (first 200 chars) for the list view
        d["preview"] = note.content[:200].rstrip() + ("…" if len(note.content) > 200 else "")
    return d


@require_http_methods(["GET", "POST"])
def notes_list(request):
    """
    GET  /api/notes/          — list all notes (with preview, no full content)
    POST /api/notes/          — create a new note
    """
    if request.method == "GET":
        notes = Note.objects.all()
        return JsonResponse({"notes": [_note_to_dict(n, include_content=False) for n in notes]})

    # POST — create
    try:
        body = json.loads(request.body)
    except (json.JSONDecodeError, UnicodeDecodeError):
        return JsonResponse({"error": "Invalid JSON."}, status=400)

    title   = str(body.get("title",   "")).strip()
    subject = str(body.get("subject", "Other")).strip()
    content = str(body.get("content", "")).strip()

    errors = {}
    if not title:
        errors["title"] = "Title is required."
    elif len(title) > 200:
        errors["title"] = "Title must be 200 characters or fewer."
    if not content:
        errors["content"] = "Content is required."
    if subject not in _VALID_SUBJECTS:
        subject = "Other"

    if errors:
        return JsonResponse({"errors": errors}, status=422)

    note = Note.objects.create(title=title, subject=subject, content=content)
    return JsonResponse(_note_to_dict(note), status=201)


@require_http_methods(["GET", "PUT", "DELETE"])
def note_detail(request, pk: int):
    """
    GET    /api/notes/<pk>/   — retrieve one note with full content
    PUT    /api/notes/<pk>/   — update a note
    DELETE /api/notes/<pk>/   — delete a note
    """
    try:
        note = Note.objects.get(pk=pk)
    except Note.DoesNotExist:
        return JsonResponse({"error": f"Note {pk} not found."}, status=404)

    if request.method == "GET":
        return JsonResponse(_note_to_dict(note, include_content=True))

    if request.method == "DELETE":
        note.delete()
        return JsonResponse({"deleted": pk})

    # PUT — update
    try:
        body = json.loads(request.body)
    except (json.JSONDecodeError, UnicodeDecodeError):
        return JsonResponse({"error": "Invalid JSON."}, status=400)

    title   = str(body.get("title",   note.title)).strip()
    subject = str(body.get("subject", note.subject)).strip()
    content = str(body.get("content", note.content)).strip()

    errors = {}
    if not title:
        errors["title"] = "Title is required."
    elif len(title) > 200:
        errors["title"] = "Title must be 200 characters or fewer."
    if not content:
        errors["content"] = "Content is required."
    if subject not in _VALID_SUBJECTS:
        subject = "Other"

    if errors:
        return JsonResponse({"errors": errors}, status=422)

    note.title   = title
    note.subject = subject
    note.content = content
    note.save()
    return JsonResponse(_note_to_dict(note, include_content=True))


# ══════════════════════════════════════════════════════════════════════════════
# Study Planner API
# ══════════════════════════════════════════════════════════════════════════════

from .models import StudyTask

_VALID_PRIORITIES = {"low", "medium", "high"}

# Mirror the subject list from StudyTask.SUBJECT_CHOICES
_VALID_TASK_SUBJECTS = {
    "Computer Networks", "Operating Systems", "DBMS", "Java",
    "Web Development", "Mathematics", "Physics", "Chemistry",
    "Biology", "History", "Other",
}


def _task_to_dict(task: StudyTask) -> dict:
    """Serialise a StudyTask to a plain dict for JSON responses."""
    return {
        "id":           task.pk,
        "title":        task.title,
        "subject":      task.subject,
        "description":  task.description,
        "due_date":     task.due_date.isoformat(),   # "YYYY-MM-DD"
        "priority":     task.priority,
        "duration":     task.duration,
        "completed":    task.completed,
        "created":      task.created.isoformat(),
        "updated":      task.updated.isoformat(),
        # Revision fields — null for regular (non-revision) tasks
        "note_id":      task.note_id,
        "revision_day": task.revision_day,
    }


def _parse_task_body(body: dict, existing: "StudyTask | None" = None) -> tuple[dict, dict]:
    """
    Validate and extract task fields from a request body dict.
    Returns (fields_dict, errors_dict).
    If `existing` is provided, missing fields fall back to the existing values
    (used for PUT / partial updates).
    """
    import datetime

    def _get(key, default=""):
        if key in body:
            return body[key]
        if existing is not None:
            return getattr(existing, key, default)
        return default

    title       = str(_get("title",       "")).strip()
    subject     = str(_get("subject",     "Other")).strip()
    description = str(_get("description", "")).strip()
    due_date_raw = _get("due_date", "")
    priority    = str(_get("priority",    "medium")).strip().lower()
    duration_raw = _get("duration", 30)
    completed   = _get("completed", False)

    errors: dict = {}

    if not title:
        errors["title"] = "Title is required."
    elif len(title) > 200:
        errors["title"] = "Title must be 200 characters or fewer."

    if subject not in _VALID_TASK_SUBJECTS:
        subject = "Other"

    if priority not in _VALID_PRIORITIES:
        priority = "medium"

    # due_date validation
    due_date = None
    if isinstance(due_date_raw, datetime.date):
        due_date = due_date_raw
    elif isinstance(due_date_raw, str) and due_date_raw:
        try:
            due_date = datetime.date.fromisoformat(due_date_raw)
        except ValueError:
            errors["due_date"] = "Due date must be a valid date (YYYY-MM-DD)."
    else:
        errors["due_date"] = "Due date is required."

    # duration validation
    try:
        duration = int(duration_raw)
        if duration < 1:
            duration = 1
        if duration > 1440:
            errors["duration"] = "Duration must be between 1 and 1440 minutes."
    except (TypeError, ValueError):
        duration = 30

    fields = {
        "title":       title,
        "subject":     subject,
        "description": description,
        "due_date":    due_date,
        "priority":    priority,
        "duration":    duration,
        "completed":   bool(completed),
    }
    return fields, errors


@require_http_methods(["GET", "POST"])
def tasks_list(request):
    """
    GET  /api/tasks/   — list all study tasks
    POST /api/tasks/   — create a new study task
    """
    if request.method == "GET":
        tasks = StudyTask.objects.all()
        return JsonResponse({"tasks": [_task_to_dict(t) for t in tasks]})

    # POST — create
    try:
        body = json.loads(request.body)
    except (json.JSONDecodeError, UnicodeDecodeError):
        return JsonResponse({"error": "Invalid JSON."}, status=400)

    fields, errors = _parse_task_body(body)
    if errors:
        return JsonResponse({"errors": errors}, status=422)

    task = StudyTask.objects.create(**fields)
    return JsonResponse(_task_to_dict(task), status=201)


@require_http_methods(["GET", "PUT", "DELETE"])
def task_detail(request, pk: int):
    """
    GET    /api/tasks/<pk>/   — retrieve one task
    PUT    /api/tasks/<pk>/   — update a task
    DELETE /api/tasks/<pk>/   — delete a task
    """
    try:
        task = StudyTask.objects.get(pk=pk)
    except StudyTask.DoesNotExist:
        return JsonResponse({"error": f"Task {pk} not found."}, status=404)

    if request.method == "GET":
        return JsonResponse(_task_to_dict(task))

    if request.method == "DELETE":
        task.delete()
        return JsonResponse({"deleted": pk})

    # PUT — update
    try:
        body = json.loads(request.body)
    except (json.JSONDecodeError, UnicodeDecodeError):
        return JsonResponse({"error": "Invalid JSON."}, status=400)

    fields, errors = _parse_task_body(body, existing=task)
    if errors:
        return JsonResponse({"errors": errors}, status=422)

    for attr, value in fields.items():
        setattr(task, attr, value)
    task.save()
    return JsonResponse(_task_to_dict(task))


# ══════════════════════════════════════════════════════════════════════════════
# Time-Travel Revision Plan API
# ══════════════════════════════════════════════════════════════════════════════

# Spaced-repetition day offsets used by the revision plan.
_REVISION_DAYS = [1, 3, 7, 14]

# Duration in minutes assigned to each revision session.
# Shorter than a full study session — revision is a review, not first-pass learning.
_REVISION_DURATIONS = {1: 30, 3: 25, 7: 20, 14: 20}


@require_http_methods(["POST"])
def create_revision_plan(request):
    """
    POST /api/revision-plan/
    Body: { "note_id": <int> }

    Creates up to 4 spaced-repetition revision tasks for the given note:
      Day 1, Day 3, Day 7, Day 14 from today (Asia/Kolkata local date).

    Deduplication key: (note_id, revision_day).
    A task is skipped if a StudyTask already exists with the same note FK and
    the same revision_day value.  This is reliable regardless of whether the
    user edits the task's title, description, or due date afterwards.

    If the note is deleted the tasks are preserved (note FK is SET_NULL) and
    the endpoint returns 404 for future calls with that note_id.
    """
    import datetime
    import zoneinfo

    try:
        body = json.loads(request.body)
    except (json.JSONDecodeError, UnicodeDecodeError):
        return JsonResponse({"error": "Invalid JSON. Expected: { note_id: <int> }"}, status=400)

    note_id = body.get("note_id")
    if not isinstance(note_id, int):
        return JsonResponse({"error": "'note_id' must be an integer."}, status=400)

    # Verify the note exists
    try:
        note = Note.objects.get(pk=note_id)
    except Note.DoesNotExist:
        return JsonResponse({"error": f"Note {note_id} not found."}, status=404)

    # Today's local date in the configured timezone (Asia/Kolkata).
    # Using zoneinfo (stdlib since Python 3.9) — no extra packages needed.
    tz_name = getattr(
        __import__("django.conf", fromlist=["settings"]).settings,
        "TIME_ZONE",
        "UTC",
    )
    try:
        tz = zoneinfo.ZoneInfo(tz_name)
    except (zoneinfo.ZoneInfoNotFoundError, KeyError):
        tz = zoneinfo.ZoneInfo("UTC")

    today = datetime.datetime.now(tz=tz).date()

    # Build the set of revision_day values that already have a task for this note.
    existing_days = set(
        StudyTask.objects.filter(note_id=note_id, revision_day__isnull=False)
        .values_list("revision_day", flat=True)
    )

    created_tasks: list[dict] = []
    skipped_days:  list[int]  = []

    for day in _REVISION_DAYS:
        if day in existing_days:
            skipped_days.append(day)
            continue

        due = today + datetime.timedelta(days=day)
        # Title is capped at 200 chars (model constraint).
        # "Day X Revision: " prefix = 18 chars max ("Day 14 Revision: " = 17),
        # leaving at least 183 chars for the note title.
        title = f"Day {day} Revision: {note.title}"
        if len(title) > 200:
            title = title[:197] + "…"

        task = StudyTask.objects.create(
            title=title,
            subject=note.subject,
            description=(
                f"Spaced-repetition revision session for your note:\n"
                f'"{note.title}"\n\n'
                f"Review your notes, test yourself on key concepts, "
                f"and check anything you got wrong in earlier quizzes."
            ),
            due_date=due,
            priority="high",
            duration=_REVISION_DURATIONS.get(day, 25),
            completed=False,
            note=note,
            revision_day=day,
        )
        created_tasks.append(_task_to_dict(task))

    return JsonResponse({
        "created":      len(created_tasks),
        "skipped":      len(skipped_days),
        "skipped_days": skipped_days,
        "tasks":        created_tasks,
        "note_title":   note.title,
    }, status=201 if created_tasks else 200)




from .models import QuizAttempt

_VALID_ATTEMPT_DIFFICULTIES = {"easy", "medium", "hard"}
_VALID_ATTEMPT_TYPES        = {"mcq", "truefalse", "mixed"}
_VALID_ATTEMPT_SUBJECTS     = {
    "Computer Networks", "Operating Systems", "DBMS", "Java",
    "Web Development", "Mathematics", "Physics", "Chemistry",
    "Biology", "History", "Other", "Unknown",
}


def _attempt_to_dict(attempt: QuizAttempt) -> dict:
    return {
        "id":              attempt.pk,
        "score":           attempt.score,
        "total_questions": attempt.total_questions,
        "percentage":      attempt.percentage,
        "difficulty":      attempt.difficulty,
        "quiz_type":       attempt.quiz_type,
        "subject":         attempt.subject,
        "taken_at":        attempt.taken_at.isoformat(),
    }


@require_http_methods(["GET", "POST"])
def quiz_attempts(request):
    """
    GET  /api/quiz-attempts/   — list all attempts (most recent first)
    POST /api/quiz-attempts/   — record a completed attempt

    POST body:
      score           int   required  — number of correct answers
      total_questions int   required  — total questions in this attempt
      difficulty      str   optional  — easy|medium|hard (default: medium)
      quiz_type       str   optional  — mcq|truefalse|mixed (default: mixed)
      subject         str   optional  — subject label (default: Unknown)

    Server recalculates percentage = round(score / total * 100).
    Client-supplied percentage values are ignored.
    """
    if request.method == "GET":
        attempts = QuizAttempt.objects.all()
        return JsonResponse({"attempts": [_attempt_to_dict(a) for a in attempts]})

    # POST — record attempt
    try:
        body = json.loads(request.body)
    except (json.JSONDecodeError, UnicodeDecodeError):
        return JsonResponse({"error": "Invalid JSON."}, status=400)

    errors: dict = {}

    # score
    score_raw = body.get("score")
    try:
        score = int(score_raw)
    except (TypeError, ValueError):
        score = None
        errors["score"] = "score must be a non-negative integer."

    # total_questions
    total_raw = body.get("total_questions")
    try:
        total = int(total_raw)
    except (TypeError, ValueError):
        total = None
        errors["total_questions"] = "total_questions must be a positive integer."

    # Cross-field validation (only when both parsed successfully)
    if score is not None and total is not None:
        if total < 1:
            errors["total_questions"] = "total_questions must be at least 1."
        elif total > 100:
            errors["total_questions"] = "total_questions cannot exceed 100."
        elif score < 0:
            errors["score"] = "score cannot be negative."
        elif score > total:
            errors["score"] = "score cannot exceed total_questions."

    if errors:
        return JsonResponse({"errors": errors}, status=422)

    # Server recalculates percentage — never trusts client value
    percentage = round(score / total * 100)

    difficulty = str(body.get("difficulty", "medium")).lower()
    if difficulty not in _VALID_ATTEMPT_DIFFICULTIES:
        difficulty = "medium"

    quiz_type = str(body.get("quiz_type", "mixed")).lower()
    if quiz_type not in _VALID_ATTEMPT_TYPES:
        quiz_type = "mixed"

    subject = str(body.get("subject", "Unknown")).strip()
    if subject not in _VALID_ATTEMPT_SUBJECTS:
        subject = "Unknown"

    attempt = QuizAttempt.objects.create(
        score=score,
        total_questions=total,
        percentage=percentage,
        difficulty=difficulty,
        quiz_type=quiz_type,
        subject=subject,
    )
    return JsonResponse(_attempt_to_dict(attempt), status=201)


# ══════════════════════════════════════════════════════════════════════════════
# Progress Statistics API
# ══════════════════════════════════════════════════════════════════════════════

import datetime
from django.db.models import Avg, Count, Q
from django.utils import timezone


@require_http_methods(["GET"])
def progress_stats(request):
    """
    GET /api/progress/

    Returns aggregated statistics derived entirely from database records.
    No hardcoded sample data.
    """
    today = datetime.date.today()

    # ── Notes stats ────────────────────────────────────────────────────────
    notes_qs = Note.objects.all()
    total_notes = notes_qs.count()

    # Notes per subject (only subjects with at least one note)
    notes_by_subject = list(
        notes_qs.values("subject")
                .annotate(count=Count("id"))
                .order_by("-count")
    )

    # ── Task stats ─────────────────────────────────────────────────────────
    tasks_qs = StudyTask.objects.all()
    total_tasks     = tasks_qs.count()
    completed_tasks = tasks_qs.filter(completed=True).count()
    pending_tasks   = tasks_qs.filter(completed=False).count()
    overdue_tasks   = tasks_qs.filter(completed=False, due_date__lt=today).count()

    # Tasks per subject
    tasks_by_subject = list(
        tasks_qs.values("subject")
                .annotate(total=Count("id"),
                          done=Count("id", filter=Q(completed=True)))
                .order_by("-total")
    )

    # ── Quiz stats ─────────────────────────────────────────────────────────
    attempts_qs  = QuizAttempt.objects.all()
    total_attempts = attempts_qs.count()
    avg_pct_agg    = attempts_qs.aggregate(avg=Avg("percentage"))
    avg_percentage = round(avg_pct_agg["avg"]) if avg_pct_agg["avg"] is not None else None

    # Quiz attempts per subject (exclude Unknown when no subject was set)
    quiz_by_subject = list(
        attempts_qs.exclude(subject="Unknown")
                   .values("subject")
                   .annotate(attempts=Count("id"),
                             avg_pct=Avg("percentage"))
                   .order_by("-attempts")
    )
    # Round avg_pct
    for row in quiz_by_subject:
        row["avg_pct"] = round(row["avg_pct"]) if row["avg_pct"] is not None else 0

    # Recent quiz attempts (last 5)
    recent_attempts = [_attempt_to_dict(a) for a in attempts_qs[:5]]

    # ── Activity: tasks completed per day, last 14 days ──────────────────
    # All datetime comparisons use local time so the chart matches the
    # user's calendar day rather than UTC.  Django stores datetimes as UTC
    # (USE_TZ=True); timezone.localtime() converts to the server's local tz.
    local_now  = timezone.localtime(timezone.now())
    today_local = local_now.date()

    # Build a 14-day date index ending today (local)
    date_index  = [today_local - datetime.timedelta(days=i) for i in range(13, -1, -1)]
    date_labels = [d.strftime("%b %d") for d in date_index]
    date_iso    = [d.isoformat() for d in date_index]

    cutoff_date = date_index[0]   # earliest date in the window

    # Tasks completed per day — use updated (local date) when completed=True
    tasks_completed_per_day: dict[str, int] = {d: 0 for d in date_iso}
    for t in tasks_qs.filter(completed=True, updated__date__gte=cutoff_date):
        key = timezone.localtime(t.updated).date().isoformat()
        if key in tasks_completed_per_day:
            tasks_completed_per_day[key] += 1

    # Quiz attempts per day (local date)
    quiz_per_day: dict[str, int] = {d: 0 for d in date_iso}
    for a in attempts_qs.filter(taken_at__date__gte=cutoff_date):
        key = timezone.localtime(a.taken_at).date().isoformat()
        if key in quiz_per_day:
            quiz_per_day[key] += 1

    activity_chart = {
        "labels":        date_labels,
        "tasks_done":    [tasks_completed_per_day[d] for d in date_iso],
        "quiz_attempts": [quiz_per_day[d]            for d in date_iso],
    }

    # ── Recent activity feed (cross-model, last 8 items by time) ──────────
    recent_activity = []

    # Recent notes (last 4)
    for n in notes_qs.order_by("-created")[:4]:
        recent_activity.append({
            "type":    "note",
            "icon":    "📄",
            "title":   f'Saved note "{n.title}"',
            "subject": n.subject,
            "time":    n.created.isoformat(),
        })

    # Recently completed tasks (last 4)
    for t in tasks_qs.filter(completed=True).order_by("-updated")[:4]:
        recent_activity.append({
            "type":    "task",
            "icon":    "✅",
            "title":   f'Completed "{t.title}"',
            "subject": t.subject,
            "time":    t.updated.isoformat(),
        })

    # Recent quiz attempts (last 4)
    for a in attempts_qs[:4]:
        recent_activity.append({
            "type":    "quiz",
            "icon":    "🧠",
            "title":   f"Scored {a.percentage}% on a {a.difficulty} quiz",
            "subject": a.subject if a.subject != "Unknown" else None,
            "time":    a.taken_at.isoformat(),
        })

    # Sort by time descending, keep top 8
    recent_activity.sort(key=lambda x: x["time"], reverse=True)
    recent_activity = recent_activity[:8]

    return JsonResponse({
        # Notes
        "total_notes":        total_notes,
        "notes_by_subject":   notes_by_subject,
        # Tasks
        "total_tasks":        total_tasks,
        "completed_tasks":    completed_tasks,
        "pending_tasks":      pending_tasks,
        "overdue_tasks":      overdue_tasks,
        "tasks_by_subject":   tasks_by_subject,
        # Quiz
        "total_attempts":     total_attempts,
        "avg_percentage":     avg_percentage,
        "quiz_by_subject":    quiz_by_subject,
        "recent_attempts":    recent_attempts,
        # Activity
        "activity_chart":     activity_chart,
        # Feed
        "recent_activity":    recent_activity,
    })


# ══════════════════════════════════════════════════════════════════════════════
# Adaptive Quest System
# ══════════════════════════════════════════════════════════════════════════════

import zoneinfo
from django.db import IntegrityError, OperationalError, transaction
from .models import DailyQuestLog

# ── Helpers ───────────────────────────────────────────────────────────────────

def _local_today() -> "datetime.date":
    """Return today's date in Asia/Kolkata (server timezone)."""
    from django.conf import settings as _settings
    tz_name = getattr(_settings, "TIME_ZONE", "UTC")
    try:
        tz = zoneinfo.ZoneInfo(tz_name)
    except Exception:
        tz = zoneinfo.ZoneInfo("UTC")
    return datetime.datetime.now(tz=tz).date()


def _xp_and_level(total_xp: int) -> dict:
    """
    Compute level and progress toward next level from cumulative XP.
    Thresholds: L1 0-99, L2 100-249, L3 250-449, L4 450-699, L5 700+
    """
    thresholds = [
        (1,   0,   99,  100),   # (level, start, end, span)
        (2, 100,  249,  150),
        (3, 250,  449,  200),
        (4, 450,  699,  250),
        (5, 700, 9999, None),   # no cap on L5
    ]
    for level, start, end, span in thresholds:
        if total_xp <= end or span is None:
            within = total_xp - start
            progress_pct = min(100, round(within / span * 100)) if span else 100
            xp_to_next   = max(0, end + 1 - total_xp) if span else 0
            return {
                "level":        level,
                "total_xp":     total_xp,
                "xp_to_next":   xp_to_next,
                "progress_pct": progress_pct,
                "level_start":  start,
                "level_end":    end if span else None,
            }
    # Fallback (shouldn't reach here)
    return {"level": 5, "total_xp": total_xp, "xp_to_next": 0, "progress_pct": 100,
            "level_start": 700, "level_end": None}


# ── XP reward table ───────────────────────────────────────────────────────────
_QUEST_XP = {
    "revision":  40,
    "knowledge": 20,
    "battle":    30,
    "growth":    50,
}


# ── Quest generation ──────────────────────────────────────────────────────────

def _generate_quests(today: "datetime.date") -> list[dict]:
    """
    Build today's quest list from existing data. Returns a list of quest dicts.
    Each quest has:
      quest_key, quest_type, title, description, xp, destination,
      claimable (bool), claimable_reason (str explaining why not if False),
      already_claimed (bool).
    """
    quests: list[dict] = []
    today_iso = today.isoformat()

    # Already-claimed keys for today
    claimed_keys = set(
        DailyQuestLog.objects.filter(quest_date=today)
                             .values_list("quest_key", flat=True)
    )

    # ── 1. Revision Quests (up to 2) ─────────────────────────────────────────
    # Revision tasks due today or overdue, not yet completed.
    due_revision = (
        StudyTask.objects
        .filter(revision_day__isnull=False, completed=False, due_date__lte=today)
        .select_related("note")
        .order_by("due_date")[:2]
    )
    for task in due_revision:
        key = f"revision:{task.pk}"
        note_title = task.note.title if task.note_id else task.title
        quests.append({
            "quest_key":       key,
            "quest_type":      "revision",
            "title":           f"Revisit: {note_title[:50]}",
            "description":     (
                f"Complete your Day {task.revision_day} revision session "
                f"for \"{note_title[:60]}\". "
                f"Mark it done in the Planner to earn XP."
            ),
            "xp":              _QUEST_XP["revision"],
            "destination":     "/planner",
            "task_id":         task.pk,
            # Claimable only when the task has been marked complete.
            # This is re-evaluated at claim time on the server; the frontend
            # uses this hint to show the correct button state on load.
            "claimable":       task.completed,
            "claimable_reason": "" if task.completed else
                                "Mark this revision task complete in the Planner first.",
            "already_claimed": key in claimed_keys,
        })

    # ── 2. Knowledge Quest (1) ────────────────────────────────────────────────
    # Pick the least-recently-updated note so users revisit old material.
    note_qs = Note.objects.order_by("updated")
    note = note_qs.first()
    if note:
        key = f"knowledge:{note.pk}"
        quests.append({
            "quest_key":       key,
            "quest_type":      "knowledge",
            "title":           f"Review: {note.title[:50]}",
            "description":     (
                f"Re-read your \"{note.title[:60]}\" notes in {note.subject}. "
                f"Click \"Mark Reviewed\" below to earn XP."
            ),
            "xp":              _QUEST_XP["knowledge"],
            "destination":     "/notes",
            "note_id":         note.pk,
            # Knowledge quest is always claimable — the user acknowledges review
            # by clicking the claim button. The server records it once.
            "claimable":       True,
            "claimable_reason": "",
            "already_claimed": key in claimed_keys,
        })

    # ── 3. Battle Quest (1) ───────────────────────────────────────────────────
    # Claimable when the user completes a quiz/boss attempt AFTER this quest
    # was generated today. We use today midnight (local) as the lower bound.
    # At claim time, the server rechecks this independently.
    key = f"battle:{today_iso}"
    # Count attempts taken today (after local midnight)
    tz_name = "Asia/Kolkata"
    try:
        tz = zoneinfo.ZoneInfo(tz_name)
    except Exception:
        tz = zoneinfo.ZoneInfo("UTC")
    today_midnight_utc = datetime.datetime(
        today.year, today.month, today.day, tzinfo=tz
    )
    battle_done_today = QuizAttempt.objects.filter(
        taken_at__gte=today_midnight_utc
    ).exists()

    quests.append({
        "quest_key":       key,
        "quest_type":      "battle",
        "title":           "Face the Boss",
        "description":     "Complete a Quiz or Exam Boss Battle today to earn XP.",
        "xp":              _QUEST_XP["battle"],
        "destination":     "/boss",
        "claimable":       battle_done_today,
        "claimable_reason": "" if battle_done_today else
                            "Complete a quiz or Boss Battle first.",
        "already_claimed": key in claimed_keys,
    })

    # ── 4. Growth Quest (1, only if sufficient data exists) ──────────────────
    # Requires ≥ 2 attempts for some subject with avg < 75%.
    weak_subjects = (
        QuizAttempt.objects
        .exclude(subject="Unknown")
        .values("subject")
        .annotate(n=Count("id"), avg=Avg("percentage"))
        .filter(n__gte=2, avg__lt=75)
        .order_by("avg")      # worst first
    )
    weakest = weak_subjects.first()
    if weakest:
        subj = weakest["subject"]
        avg  = round(weakest["avg"])
        key  = f"growth:{subj}:{today_iso}"
        quests.append({
            "quest_key":       key,
            "quest_type":      "growth",
            "title":           f"Level Up: {subj}",
            "description":     (
                f"Your {subj} average is {avg}%. "
                f"Take a quiz on this subject to improve your score and earn XP."
            ),
            "xp":              _QUEST_XP["growth"],
            "destination":     "/quiz",
            "subject":         subj,
            # Claimable once a quiz attempt for this subject is recorded today.
            "claimable":       QuizAttempt.objects.filter(
                                   subject=subj,
                                   taken_at__gte=today_midnight_utc,
                               ).exists(),
            "claimable_reason": f"Take a {subj} quiz today first.",
            "already_claimed": key in claimed_keys,
        })

    return quests


# ── Views ─────────────────────────────────────────────────────────────────────

@require_http_methods(["GET"])
def quests_today(request):
    """
    GET /api/quests/
    Returns today's quests, XP totals, level, and progress.
    """
    today = _local_today()

    quests = _generate_quests(today)

    # Total XP from all time (persisted in DailyQuestLog)
    from django.db.models import Sum
    total_xp_agg = DailyQuestLog.objects.aggregate(total=Sum("xp_awarded"))
    total_xp = total_xp_agg["total"] or 0

    level_info = _xp_and_level(total_xp)

    # Today's completion counts
    claimed_today = DailyQuestLog.objects.filter(quest_date=today).count()
    total_today   = len(quests)

    return JsonResponse({
        "date":          today.isoformat(),
        "quests":        quests,
        "claimed_today": claimed_today,
        "total_today":   total_today,
        **level_info,
    })


@require_http_methods(["POST"])
def claim_quest(request):
    """
    POST /api/quests/claim/
    Body: { "quest_key": "<key>", "quest_date": "YYYY-MM-DD" }

    Server validates:
      1. quest_date == today (Asia/Kolkata) — rejects stale/forged dates
      2. quest_key matches a valid quest generated for today
      3. The quest's completion condition is met (task done, quiz taken, etc.)
      4. Records the claim atomically — unique_together prevents double awards
    """
    try:
        body = json.loads(request.body)
    except (json.JSONDecodeError, UnicodeDecodeError):
        return JsonResponse({"error": "Invalid JSON."}, status=400)

    quest_key  = body.get("quest_key",  "")
    date_str   = body.get("quest_date", "")

    if not isinstance(quest_key, str) or not quest_key.strip():
        return JsonResponse({"error": "'quest_key' is required."}, status=400)

    # ── Date validation ───────────────────────────────────────────────────────
    today = _local_today()
    try:
        claimed_date = datetime.date.fromisoformat(date_str)
    except (ValueError, TypeError):
        return JsonResponse({"error": "Invalid quest_date format. Use YYYY-MM-DD."}, status=400)

    if claimed_date != today:
        return JsonResponse({
            "error": "Quest date does not match today. Past and future claims are not allowed.",
            "today": today.isoformat(),
        }, status=400)

    # ── Regenerate today's quests and find the matching one ──────────────────
    # For revision quests, the task may already be completed and thus no longer
    # appear in the active quest list.  We validate revision claims directly
    # from the task pk embedded in the key, then fall back to the quest list
    # for all other types.
    quests = _generate_quests(today)
    matching = next((q for q in quests if q["quest_key"] == quest_key), None)

    # Special handling: revision quest with a completed task won't appear in
    # _generate_quests (which only shows incomplete tasks).  Reconstruct it.
    if matching is None and quest_key.startswith("revision:"):
        try:
            task_pk = int(quest_key.split(":", 1)[1])
            task = StudyTask.objects.get(pk=task_pk, revision_day__isnull=False)
            matching = {
                "quest_key":  quest_key,
                "quest_type": "revision",
                "xp":         _QUEST_XP["revision"],
                "task_id":    task.pk,
                "already_claimed": DailyQuestLog.objects.filter(
                    quest_key=quest_key, quest_date=today).exists(),
            }
        except (ValueError, StudyTask.DoesNotExist):
            pass

    if matching is None:
        return JsonResponse({
            "error": f"Quest '{quest_key}' is not valid for today.",
        }, status=400)

    if matching["already_claimed"]:
        return JsonResponse({
            "already_claimed": True,
            "message":         "Quest already completed today — XP was already awarded.",
        }, status=409)

    # ── Completion condition verification ─────────────────────────────────────
    qt = matching["quest_type"]

    if qt == "revision":
        # Verify the task is actually complete now
        task_pk = matching.get("task_id")
        try:
            task = StudyTask.objects.get(pk=task_pk)
        except StudyTask.DoesNotExist:
            return JsonResponse({"error": "Revision task no longer exists."}, status=400)
        if not task.completed:
            return JsonResponse({
                "error": "Revision task is not yet complete. Mark it done in the Planner first.",
                "claimable": False,
            }, status=400)

    elif qt == "battle":
        # Verify at least one quiz attempt today (after local midnight)
        tz_name = "Asia/Kolkata"
        try:
            tz = zoneinfo.ZoneInfo(tz_name)
        except Exception:
            tz = zoneinfo.ZoneInfo("UTC")
        today_midnight_utc = datetime.datetime(today.year, today.month, today.day, tzinfo=tz)
        if not QuizAttempt.objects.filter(taken_at__gte=today_midnight_utc).exists():
            return JsonResponse({
                "error": "No qualifying quiz attempt found for today.",
                "claimable": False,
            }, status=400)

    elif qt == "growth":
        subj = matching.get("subject", "")
        tz_name = "Asia/Kolkata"
        try:
            tz = zoneinfo.ZoneInfo(tz_name)
        except Exception:
            tz = zoneinfo.ZoneInfo("UTC")
        today_midnight_utc = datetime.datetime(today.year, today.month, today.day, tzinfo=tz)
        if not QuizAttempt.objects.filter(
            subject=subj, taken_at__gte=today_midnight_utc
        ).exists():
            return JsonResponse({
                "error": f"No qualifying {subj} quiz attempt found for today.",
                "claimable": False,
            }, status=400)

    # qt == "knowledge": always claimable once per day; no external condition

    # ── Atomic claim (database-level dedup via unique_together) ───────────────
    # SQLite raises OperationalError("database is locked") when a concurrent
    # write holds the file lock.  We retry up to _CLAIM_MAX_RETRIES times with
    # a short sleep, then give up and ask the client to retry.
    # Before each retry we check whether the row already exists — if it does,
    # the concurrent request won the race and we return 409 without retrying.
    # This is safe: unique_together still prevents any duplicate XP award even
    # if two retries somehow race past the pre-check.
    import time as _time
    _CLAIM_MAX_RETRIES = 3
    _CLAIM_RETRY_DELAY = 0.05   # 50 ms between attempts

    xp = _QUEST_XP.get(qt, 0)
    last_exc = None

    for attempt in range(_CLAIM_MAX_RETRIES):
        # Pre-check: if already claimed (race winner), return 409 immediately
        if DailyQuestLog.objects.filter(quest_key=quest_key, quest_date=today).exists():
            return JsonResponse({
                "already_claimed": True,
                "message": "Quest already completed today — XP was already awarded.",
            }, status=409)

        try:
            with transaction.atomic():
                log, created = DailyQuestLog.objects.get_or_create(
                    quest_key=quest_key,
                    quest_date=today,
                    defaults={"quest_type": qt, "xp_awarded": xp},
                )
        except IntegrityError:
            # Uniqueness violation — concurrent request won the race
            return JsonResponse({
                "already_claimed": True,
                "message": "Quest already completed today — XP was already awarded.",
            }, status=409)
        except OperationalError as exc:
            # Transient lock — sleep and retry
            last_exc = exc
            if attempt < _CLAIM_MAX_RETRIES - 1:
                _time.sleep(_CLAIM_RETRY_DELAY)
            continue

        # get_or_create succeeded
        if not created:
            return JsonResponse({
                "already_claimed": True,
                "message": "Quest already completed today — XP was already awarded.",
            }, status=409)

        # Successfully claimed — break out of retry loop
        break
    else:
        # All retries exhausted due to OperationalError
        return JsonResponse({
            "error": (
                "The database is temporarily busy. "
                "Please try again in a moment."
            ),
            "detail": str(last_exc),
        }, status=503)

    # Recalculate totals
    from django.db.models import Sum
    total_xp = DailyQuestLog.objects.aggregate(total=Sum("xp_awarded"))["total"] or 0
    level_info = _xp_and_level(total_xp)

    return JsonResponse({
        "already_claimed": False,
        "xp_awarded":      xp,
        "quest_key":       quest_key,
        **level_info,
    }, status=200)


# ══════════════════════════════════════════════════════════════════════════════
# Explain-It-To-Nova — Concept coverage checker
# ══════════════════════════════════════════════════════════════════════════════
#
# Algorithm (fully extractive, no paid AI, no external service):
#
#   1. Extract candidate concepts from the reference text using the same
#      tokenizer and term-extraction pipeline as the Summarizer.
#   2. For each concept, check the student's explanation:
#        • COVERED  (score 1.0) — the concept word or a known alias appears in
#          the explanation (after normalisation and stop-word removal).
#        • PARTIAL  (score 0.5) — a prefix or suffix share of ≥ 60 % of the
#          concept's characters is found (conservative fuzzy match).
#        • MISSING  (score 0.0) — not found.
#   3. Concept Coverage % = (sum of scores) / (total concepts) × 100.
#      Client-supplied scores are NEVER trusted.
#   4. Return the three concept lists, the score, and a short feedback message.
#
# What this does NOT claim: semantic understanding, paraphrase detection, or
# knowledge verification.  The UI must label the score "Concept Coverage" and
# explain this limitation.
# ─────────────────────────────────────────────────────────────────────────────

# Known aliases: if ANY alias token appears in the explanation the concept is
# considered covered.  Keys are lowercase concept tokens.
_CONCEPT_ALIASES: dict[str, list[str]] = {
    # Abbreviations ↔ full forms
    "os":                 ["operating system", "operating systems"],
    "operating system":   ["os"],
    "operating systems":  ["os"],
    "cpu":                ["processor", "central processing unit"],
    "ram":                ["memory", "random access memory"],
    "sql":                ["structured query language", "query language"],
    "dbms":               ["database management system", "database system"],
    "api":                ["application programming interface"],
    "http":               ["hypertext transfer protocol"],
    "tcp":                ["transmission control protocol"],
    "ip":                 ["internet protocol"],
    "dns":                ["domain name system", "domain name service"],
    "oop":                ["object oriented", "object-oriented"],
    "jvm":                ["java virtual machine"],
    "jdk":                ["java development kit"],
    "jre":                ["java runtime environment"],
    "ioc":                ["inversion of control"],
    "aop":                ["aspect oriented programming"],
    "mvc":                ["model view controller", "model-view-controller"],
    "rest":               ["representational state transfer"],
    "jwt":                ["json web token"],
    "ssl":                ["secure sockets layer"],
    "tls":                ["transport layer security"],
    "orm":                ["object relational mapping"],
    "rdbms":              ["relational database"],
    "crud":               ["create read update delete"],
    "html":               ["hypertext markup language"],
    "css":                ["cascading style sheets"],
    "dom":                ["document object model"],
    "spa":                ["single page application"],
    "cdn":                ["content delivery network"],
    "lru":                ["least recently used"],
    "fifo":               ["first in first out"],
    "lifo":               ["last in first out"],
    "pcb":                ["process control block"],
    "tlb":                ["translation lookaside buffer"],
    "dma":                ["direct memory access"],
    "nic":                ["network interface card"],
    "mac":                ["media access control"],
    # Common subject-specific abbreviations that students often swap for full forms
    "normalization":      ["normalisation"],
    "normalisation":      ["normalization"],
    "synchronization":    ["synchronisation"],
    "synchronisation":    ["synchronization"],
    "deadlock":           ["circular wait", "mutual exclusion"],
    "semaphore":          ["mutex", "binary semaphore"],
    "mutex":              ["semaphore", "mutual exclusion"],
    "paging":             ["page table", "page frame"],
    "segmentation":       ["segment table"],
    "polymorphism":       ["overriding", "overloading"],
    "inheritance":        ["extends", "subclass", "superclass"],
    "encapsulation":      ["access modifier", "private", "getter", "setter"],
    "abstraction":        ["abstract class", "interface"],
    "concurrency":        ["parallel", "thread", "multithreading"],
    "multithreading":     ["thread", "concurrency"],
    "process":            ["task", "job", "program"],
    "scheduling":         ["scheduler", "round robin", "fcfs"],
    "virtualisation":     ["virtualization", "hypervisor"],
    "virtualization":     ["virtualisation", "hypervisor", "virtual machine"],
}

# Minimum character length for a token to be considered a concept candidate
_CONCEPT_MIN_LEN = 3

# Fuzzy match threshold: fraction of concept chars that must appear in order
# in a contiguous substring of the explanation (conservative)
_FUZZY_THRESHOLD = 0.75


def _extract_concepts(text: str, top_n: int = 20) -> list[str]:
    """
    Extract up to top_n meaningful concepts from a reference text.

    Reuses the existing NLP pipeline:
      1. clean_text  — normalise whitespace/bullets
      2. split_into_sentences  — sentence segmentation
      3. compute_freq  — word frequency counter
      4. extract_important_terms  — filter stop-words and generic terms,
                                    collapse plurals, apply acronym boost

    Returns lowercase concept strings (for comparison convenience).
    """
    cleaned = clean_text(text)
    sentences = split_into_sentences(cleaned)
    freq = compute_freq(sentences)
    raw_terms = extract_important_terms(freq, top_n=top_n)
    # Return in lowercase for downstream matching; display form preserved separately
    return [t.lower() for t in raw_terms]


def _norm_expl(text: str) -> str:
    """
    Normalise the student's explanation for matching:
      - lowercase
      - collapse whitespace
      - remove punctuation except hyphens
    """
    text = text.lower()
    text = re.sub(r'[^a-z0-9\s\-]', ' ', text)
    text = re.sub(r'\s+', ' ', text).strip()
    return text


def _concept_in_explanation(concept: str, expl_norm: str) -> float:
    """
    Return 1.0 (covered), 0.5 (partial), or 0.0 (missing) for a single concept.

    Matching strategy (applied in order; first match wins):

    1. Exact token match — concept appears as a word/phrase in the explanation.
       Also tries the simple plural form (concept + "s") because
       extract_important_terms de-pluralises candidates before returning them, so
       "relationships" in the text becomes concept "relationship", but the
       normalised explanation still contains "relationships".  Both are full
       credit — the student clearly mentioned the concept.

    2. Alias match — any known alias for this concept appears in the explanation.

    3. Conservative fuzzy match (partial credit 0.5) — a contiguous window of
       the explanation shares ≥ _FUZZY_THRESHOLD of the concept's characters.
       This step is only reached when steps 1 and 2 both fail, so a word that
       matched exactly in step 1 can never be downgraded here to 0.5.
    """
    # Step 1 — exact phrase match (word-boundary aware), including simple plural
    for form in (concept, concept + "s", concept + "es"):
        pattern = r'\b' + re.escape(form) + r'\b'
        if re.search(pattern, expl_norm):
            return 1.0

    # Step 2 — alias match
    for alias in _CONCEPT_ALIASES.get(concept, []):
        alias_pattern = r'\b' + re.escape(alias.lower()) + r'\b'
        if re.search(alias_pattern, expl_norm):
            return 1.0

    # Step 3 — conservative fuzzy match (partial credit 0.5).
    # Only reached when neither exact nor alias matched.
    # Use a sliding window of len(concept) + 4 chars over the explanation.
    # Count matching characters in order (greedy LCS-lite).
    clen = len(concept)
    window = clen + 4
    for i in range(len(expl_norm) - clen + 1):
        chunk = expl_norm[i:i + window]
        matched = 0
        ci = 0
        for ch in chunk:
            if ci < clen and ch == concept[ci]:
                matched += 1
                ci += 1
        if matched / clen >= _FUZZY_THRESHOLD:
            return 0.5

    return 0.0


def _nova_feedback(score: float, covered: list, partial: list, missing: list) -> str:
    """
    Return a short, constructive feedback string based on the coverage score.
    The message is honest about what the score measures.
    """
    total = len(covered) + len(partial) + len(missing)
    if total == 0:
        return (
            "No concepts could be extracted from the reference. "
            "Try a longer or more detailed reference."
        )
    if score >= 90:
        return (
            "Excellent concept coverage! You've addressed the vast majority "
            "of the key concepts. Review any missing ones to round out your explanation."
        )
    if score >= 70:
        return (
            "Good coverage. You've hit most of the major concepts. "
            "Focus on the missing ones to strengthen your explanation."
        )
    if score >= 50:
        return (
            "Decent start — you've covered roughly half the concepts. "
            "Try to work the missing concepts into your explanation and retry."
        )
    if score >= 25:
        return (
            "You've mentioned a few concepts, but several key ones are missing. "
            "Re-read the reference and try again — aim to cover each main idea."
        )
    return (
        "Your explanation covers very few concepts from the reference. "
        "Try to explain each main idea in your own words before checking again."
    )


# Nova input limits (characters)
_NOVA_MAX_REF   = 20_000
_NOVA_MIN_REF   = 50
_NOVA_MAX_EXPL  = 5_000
_NOVA_MIN_EXPL  = 20
_NOVA_MAX_CONCEPTS = 20


# ── Topic-mismatch detection ───────────────────────────────────────────────────
#
# Heuristic only — does NOT claim semantic understanding.
# We check how many of the reference concepts (exact match only, same normaliser)
# appear anywhere in the explanation.  When the overlap is below a conservative
# threshold the texts are likely about different topics and we surface a warning.
#
# Threshold rationale (calibrated against real notes):
#   • A correct same-topic explanation typically hits ≥ 15 % of reference concepts.
#   • A completely off-topic explanation hits 0–5 %.
#   • We only warn when the explanation is long enough (≥ 80 chars) to have had a
#     fair chance, and only when the reference yielded ≥ 5 concepts (very short
#     references produce noisy concept sets and should not trigger warnings).
#
_MISMATCH_OVERLAP_THRESHOLD = 0.15   # fraction of ref concepts that must appear
_MISMATCH_MIN_REF_CONCEPTS  = 5      # need at least this many ref concepts to judge
_MISMATCH_MIN_EXPL_CHARS    = 80     # explanation must be long enough to be fair


def _detect_topic_mismatch(ref_concepts: list[str], explanation: str) -> bool:
    """
    Return True when the explanation appears to be about a different topic
    from the reference text.

    Algorithm:
      1. Normalise the explanation with _norm_expl (same pipeline as scoring).
      2. Count how many reference concepts have an exact word-boundary match
         (including simple plural) in the normalised explanation.
         Alias matches are also counted as hits.
      3. If hits / total_ref_concepts < _MISMATCH_OVERLAP_THRESHOLD, flag as
         a likely mismatch.

    This is purely lexical — it cannot detect paraphrasing or semantically
    equivalent descriptions.  The warning is advisory only and does not alter
    the score.
    """
    if len(ref_concepts) < _MISMATCH_MIN_REF_CONCEPTS:
        return False
    if len(explanation) < _MISMATCH_MIN_EXPL_CHARS:
        return False

    expl_norm = _norm_expl(explanation)
    hits = 0
    for concept in ref_concepts:
        # Use exact + plural forms only (no fuzzy) — we want a conservative,
        # high-precision signal.  A fuzzy match on an unrelated word would
        # suppress a warranted warning.
        for form in (concept, concept + "s", concept + "es"):
            if re.search(r'\b' + re.escape(form) + r'\b', expl_norm):
                hits += 1
                break
        else:
            # Check aliases
            for alias in _CONCEPT_ALIASES.get(concept, []):
                if re.search(r'\b' + re.escape(alias.lower()) + r'\b', expl_norm):
                    hits += 1
                    break

    overlap = hits / len(ref_concepts)
    return overlap < _MISMATCH_OVERLAP_THRESHOLD


@require_http_methods(["POST"])
def nova_check(request):
    """
    POST /api/nova-check/

    Request body (JSON):
      {
        "note_id":     <int>   (optional — load a saved Note as reference),
        "ref_text":    <str>   (required when note_id is absent — pasted reference),
        "explanation": <str>   (required — the student's explanation)
      }

    Response (200):
      {
        "covered":                [<str>, ...],   // concepts found in explanation
        "partial":                [<str>, ...],   // concepts partially found
        "missing":                [<str>, ...],   // concepts not found
        "concept_coverage":       <float>,        // 0–100
        "feedback":               <str>,          // constructive message
        "total_concepts":         <int>,
        "topic_mismatch_warning": <bool>,         // true when texts seem off-topic
        "topic_mismatch_hint":    <str>           // advisory message (empty when false)
      }

    Scoring formula (server-side, client score is NEVER trusted):
      weighted_sum = sum(score_i for each concept_i)
        where score_i ∈ {1.0 covered, 0.5 partial, 0.0 missing}
      concept_coverage = (weighted_sum / total_concepts) × 100

    Topic-mismatch detection:
      A purely lexical heuristic — counts how many reference concepts appear in
      the explanation.  Fires when < 15 % of reference concepts match (exact
      word-boundary only, no fuzzy).  Does NOT alter the score; advisory only.
    """
    # ── 1. Parse request body ─────────────────────────────────────────────────
    try:
        body = json.loads(request.body)
    except (json.JSONDecodeError, UnicodeDecodeError):
        return JsonResponse(
            {"error": "Invalid JSON. Expected fields: note_id or ref_text, explanation."},
            status=400,
        )

    note_id     = body.get("note_id")
    ref_text    = body.get("ref_text", "")
    explanation = body.get("explanation", "")

    # ── 2. Load reference text ─────────────────────────────────────────────────
    if note_id is not None:
        # Validate note_id type
        if not isinstance(note_id, int):
            return JsonResponse(
                {"error": "'note_id' must be an integer."},
                status=400,
            )
        try:
            from .models import Note
            note = Note.objects.get(pk=note_id)
            ref_text = note.content
        except Note.DoesNotExist:
            return JsonResponse(
                {"error": f"Note with id {note_id} not found."},
                status=404,
            )
    else:
        # ref_text provided directly
        if not isinstance(ref_text, str):
            return JsonResponse(
                {"error": "'ref_text' must be a string."},
                status=400,
            )

    # ── 3. Validate reference text ────────────────────────────────────────────
    ref_text = ref_text.strip()
    if len(ref_text) < _NOVA_MIN_REF:
        return JsonResponse(
            {
                "error": (
                    f"Reference text is too short. "
                    f"Please provide at least {_NOVA_MIN_REF} characters."
                )
            },
            status=422,
        )
    if len(ref_text) > _NOVA_MAX_REF:
        ref_text = ref_text[:_NOVA_MAX_REF]  # silently truncate, don't error

    # ── 4. Validate explanation ───────────────────────────────────────────────
    if not isinstance(explanation, str):
        return JsonResponse(
            {"error": "'explanation' must be a string."},
            status=400,
        )
    explanation = explanation.strip()
    if len(explanation) < _NOVA_MIN_EXPL:
        return JsonResponse(
            {
                "error": (
                    f"Your explanation is too short. "
                    f"Please write at least {_NOVA_MIN_EXPL} characters."
                )
            },
            status=422,
        )
    if len(explanation) > _NOVA_MAX_EXPL:
        explanation = explanation[:_NOVA_MAX_EXPL]

    # ── 5. Extract concepts from reference ────────────────────────────────────
    concepts = _extract_concepts(ref_text, top_n=_NOVA_MAX_CONCEPTS)

    if not concepts:
        return JsonResponse(
            {
                "error": (
                    "No meaningful concepts could be extracted from the reference. "
                    "Try a longer or more detailed reference text."
                )
            },
            status=422,
        )

    # ── 6. Topic-mismatch check (advisory only — score is never altered) ──────
    mismatch = _detect_topic_mismatch(concepts, explanation)
    mismatch_hint = (
        "Your explanation may be about a different topic from your reference. "
        "Check your selected note or reference text before continuing."
        if mismatch else ""
    )

    # ── 7. Match each concept against the explanation ─────────────────────────
    expl_norm = _norm_expl(explanation)

    covered: list[str] = []
    partial: list[str] = []
    missing: list[str] = []

    weighted_sum = 0.0
    for concept in concepts:
        s = _concept_in_explanation(concept, expl_norm)
        weighted_sum += s
        # Display form: Title-case unless all-caps acronym
        display = concept.upper() if concept in _ALLCAPS_ACRONYMS else concept.title()
        if s == 1.0:
            covered.append(display)
        elif s == 0.5:
            partial.append(display)
        else:
            missing.append(display)

    total = len(concepts)
    # Server always computes the score — never trust the client
    concept_coverage = round((weighted_sum / total) * 100, 1)

    feedback = _nova_feedback(concept_coverage, covered, partial, missing)

    return JsonResponse({
        "covered":                  covered,
        "partial":                  partial,
        "missing":                  missing,
        "concept_coverage":         concept_coverage,
        "feedback":                 feedback,
        "total_concepts":           total,
        "topic_mismatch_warning":   mismatch,
        "topic_mismatch_hint":      mismatch_hint,
    })


# ── Groq Study Chatbot View ────────────────────────────────────────────────────
_DEFAULT_GROQ_MODEL = "openai/gpt-oss-120b"
_DEFAULT_FALLBACK_MODEL = "openai/gpt-oss-20b"
_MAX_HISTORY_MESSAGES = 10
_MAX_MSG_CHARS = 2500
_REQUEST_TIMEOUT = 12

@require_http_methods(["POST"])
def chat(request):
    """
    POST /api/chat/
    Groq-powered Study Chatbot endpoint with transient error retries and model fallback.
    Expects JSON:
      {
        "messages": [{"role": "user"|"model"|"assistant", "text": "..."}],
        "model": "optional-model-override"
      }
    Returns:
      {
        "reply": "...",
        "model": "..."
      }
    """
    import os
    import time
    import socket
    import urllib.request
    import urllib.error

    api_key = os.environ.get("GROQ_API_KEY", "").strip()
    if not api_key:
        # Fallback check in .env
        try:
            from django.conf import settings
            from pathlib import Path
            env_file = getattr(settings, "BASE_DIR", Path(__file__).resolve().parent.parent) / ".env"
            if env_file.exists():
                with open(env_file, "r", encoding="utf-8") as f:
                    for line in f:
                        line = line.strip()
                        if line.startswith("GROQ_API_KEY="):
                            api_key = line.split("=", 1)[1].strip().strip('"').strip("'")
                            if api_key:
                                os.environ["GROQ_API_KEY"] = api_key
                                break
        except Exception:
            pass

    if not api_key:
        return JsonResponse(
            {
                "error": (
                    "GROQ_API_KEY is not configured on the server. "
                    "Please set the GROQ_API_KEY environment variable to enable AI Study Chat."
                )
            },
            status=503,
        )

    try:
        data = json.loads(request.body.decode("utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError):
        return JsonResponse({"error": "Invalid JSON in request body."}, status=400)

    raw_messages = data.get("messages")
    if not raw_messages and isinstance(data.get("message"), str):
        raw_messages = [{"role": "user", "text": data["message"]}]

    if not isinstance(raw_messages, list) or len(raw_messages) == 0:
        return JsonResponse({"error": "Please provide a valid 'messages' list."}, status=400)

    # Sanitize and limit history
    history = raw_messages[-_MAX_HISTORY_MESSAGES:]
    formatted_messages = [
        {
            "role": "system",
            "content": (
                "You are Nova, an expert AI study companion and academic tutor for AI StudyMate Pro. "
                "Your mission is to help students learn effectively and excel in their studies.\n"
                "Guidelines:\n"
                "1. Explain concepts in clear, beginner-friendly language using simple analogies and concrete examples.\n"
                "2. When helpful, break complex topics down into numbered steps, bullet points, or concise summaries.\n"
                "3. Format code, equations, or formulas cleanly using markdown syntax.\n"
                "4. If a student asks for practice or revision, provide 2-3 focused practice questions with hints.\n"
                "5. Keep responses encouraging, educational, and focused on learning."
            ),
        }
    ]

    for item in history:
        if not isinstance(item, dict):
            continue
        role = item.get("role", "user")
        groq_role = "assistant" if role in ("assistant", "system", "model", "bot") else "user"

        text = str(item.get("text", "")).strip()
        if not text:
            continue
        if len(text) > _MAX_MSG_CHARS:
            text = text[:_MAX_MSG_CHARS] + "..."

        formatted_messages.append({
            "role": groq_role,
            "content": text,
        })

    # Ensure there is at least one user message
    has_user_msg = any(m["role"] == "user" for m in formatted_messages)
    if not has_user_msg:
        return JsonResponse({"error": "At least one user message is required."}, status=400)

    primary_model = (
        data.get("model")
        or os.environ.get("GROQ_MODEL")
        or _DEFAULT_GROQ_MODEL
    ).strip()

    fallback_model = (
        os.environ.get("GROQ_FALLBACK_MODEL")
        or (_DEFAULT_FALLBACK_MODEL if primary_model != _DEFAULT_FALLBACK_MODEL else "llama-3.1-8b-instant")
    ).strip()

    models_to_try = [primary_model]
    if fallback_model and fallback_model != primary_model:
        models_to_try.append(fallback_model)

    req_url = "https://api.groq.com/openai/v1/chat/completions"
    last_error_message = ""
    last_status_code = 502
    successful_data = None
    successful_model = None

    for model_name in models_to_try:
        groq_payload = {
            "model": model_name,
            "messages": formatted_messages,
            "temperature": 0.7,
            "max_tokens": 1500,
        }
        req_body = json.dumps(groq_payload).encode("utf-8")

        # Max 2 attempts per model for transient errors
        for attempt in range(1, 3):
            req = urllib.request.Request(
                req_url,
                data=req_body,
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {api_key}",
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) StudyMatePro/1.0",
                },
                method="POST",
            )
            try:
                with urllib.request.urlopen(req, timeout=_REQUEST_TIMEOUT) as resp:
                    successful_data = json.loads(resp.read().decode("utf-8"))
                    successful_model = model_name
                    break
            except urllib.error.HTTPError as e:
                code = e.code
                err_text = ""
                try:
                    err_json = json.loads(e.read().decode("utf-8"))
                    err_text = err_json.get("error", {}).get("message", "")
                except Exception:
                    pass

                # Handle non-transient client errors immediately
                if code in (401, 403):
                    return JsonResponse(
                        {"error": "Invalid or unauthorized Groq API key. Please check your GROQ_API_KEY."},
                        status=401,
                    )
                if code == 429:
                    return JsonResponse(
                        {"error": "Groq API rate limit or quota exceeded. Please wait a moment before sending another message."},
                        status=429,
                    )
                if code == 400:
                    return JsonResponse(
                        {"error": "The request could not be processed by Groq. Please try rephrasing your message."},
                        status=400,
                    )
                if code == 404:
                    last_status_code = 404
                    last_error_message = f"Model '{model_name}' is unavailable on Groq."
                    break

                # Transient errors: 503, 500, 502, 504
                last_status_code = code
                if "high demand" in err_text.lower() or "overloaded" in err_text.lower() or code == 503:
                    last_error_message = "The Groq AI model is temporarily experiencing high demand."
                else:
                    last_error_message = err_text or "The Groq AI service is temporarily unavailable."

                if attempt == 1:
                    time.sleep(0.8)
                    continue
                else:
                    break

            except (urllib.error.URLError, TimeoutError, socket.timeout):
                last_status_code = 504
                last_error_message = "Network connection to Groq API timed out."
                if attempt == 1:
                    time.sleep(0.8)
                    continue
                else:
                    break
            except Exception:
                last_status_code = 500
                last_error_message = "An unexpected error occurred while communicating with Groq."
                break

        if successful_data:
            break

    if not successful_data:
        if last_status_code == 504:
            user_msg = "Connection to Groq timed out. Please check your internet connection and try again."
        elif last_status_code == 503 or "high demand" in last_error_message.lower():
            user_msg = "Groq is currently experiencing high demand across available models. Please try again in a few moments."
        else:
            user_msg = last_error_message or "The AI service is temporarily unavailable. Please try again shortly."
        return JsonResponse({"error": user_msg}, status=last_status_code or 502)

    choices = successful_data.get("choices", [])
    if not choices:
        return JsonResponse(
            {"error": "No response was generated by the model. Please rephrase your question."},
            status=502,
        )

    reply_text = choices[0].get("message", {}).get("content", "").strip()
    if not reply_text:
        reply_text = "I received your message, but was unable to produce an answer. Please try asking again."

    return JsonResponse({
        "reply": reply_text,
        "model": successful_model,
    })


# ══════════════════════════════════════════════════════════════════════════════
# Student Profile & Settings API
# ══════════════════════════════════════════════════════════════════════════════
from .models import StudentProfile


def _profile_to_dict(profile: StudentProfile) -> dict:
    name = (profile.display_name or "").strip() or "Student"
    initial = name[0].upper() if name else "S"
    return {
        "id": profile.id,
        "display_name": profile.display_name,
        "college": profile.college,
        "course": profile.course,
        "semester": profile.semester,
        "bio": profile.bio,
        "preferred_subjects": profile.preferred_subjects if isinstance(profile.preferred_subjects, list) else [],
        "daily_study_goal_minutes": profile.daily_study_goal_minutes,
        "avatar_initial": initial,
        "updated_at": profile.updated_at.isoformat() if profile.updated_at else None,
    }


def _calculate_study_streak(today: "datetime.date") -> int:
    """
    Calculate consecutive active study days ending today or yesterday.
    Active days include:
      - Quests claimed (DailyQuestLog.quest_date)
      - Quizzes taken (QuizAttempt.taken_at converted to local date)
      - Tasks completed (StudyTask.updated converted to local date when completed=True)
      - Notes created (Note.created converted to local date)
    """
    active_dates = set()

    for q_date in DailyQuestLog.objects.values_list("quest_date", flat=True):
        active_dates.add(q_date)

    for t in QuizAttempt.objects.values_list("taken_at", flat=True):
        active_dates.add(timezone.localtime(t).date())

    for t in StudyTask.objects.filter(completed=True).values_list("updated", flat=True):
        active_dates.add(timezone.localtime(t).date())

    for t in Note.objects.values_list("created", flat=True):
        active_dates.add(timezone.localtime(t).date())

    if not active_dates:
        return 0

    if today in active_dates:
        curr = today
    elif (today - datetime.timedelta(days=1)) in active_dates:
        curr = today - datetime.timedelta(days=1)
    else:
        return 0

    streak = 0
    while curr in active_dates:
        streak += 1
        curr -= datetime.timedelta(days=1)

    return streak


@require_http_methods(["GET", "POST", "PUT"])
def student_profile_view(request):
    """
    GET /api/profile/ — retrieve student profile, live study statistics, and available subjects.
    POST /api/profile/ — update student profile and study preferences.
    """
    from django.db.models import Sum, Avg

    profile = StudentProfile.objects.first()
    if not profile:
        profile = StudentProfile.objects.create(
            display_name="Niket",
            college="",
            course="Computer Science & Engineering",
            semester="Semester 6",
            bio="Passionate student focused on mastery and continuous learning.",
            preferred_subjects=["Computer Networks", "Operating Systems", "DBMS"],
            daily_study_goal_minutes=60,
        )

    today = _local_today()

    if request.method in ("POST", "PUT"):
        try:
            body = json.loads(request.body.decode("utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError):
            return JsonResponse({"error": "Invalid JSON in request body."}, status=400)

        errors = {}
        display_name = str(body.get("display_name", "")).strip()
        if not display_name:
            errors["display_name"] = "Display name cannot be empty."
        elif len(display_name) > 100:
            errors["display_name"] = "Display name cannot exceed 100 characters."

        college = str(body.get("college", "")).strip()
        if len(college) > 200:
            errors["college"] = "College name cannot exceed 200 characters."

        course = str(body.get("course", "")).strip()
        if len(course) > 150:
            errors["course"] = "Course name cannot exceed 150 characters."

        semester = str(body.get("semester", "")).strip()
        if len(semester) > 50:
            errors["semester"] = "Semester cannot exceed 50 characters."

        bio = str(body.get("bio", "")).strip()
        if len(bio) > 1000:
            errors["bio"] = "Bio cannot exceed 1000 characters."

        daily_goal = body.get("daily_study_goal_minutes")
        if daily_goal is not None:
            try:
                daily_goal_int = int(daily_goal)
                if daily_goal_int < 5 or daily_goal_int > 720:
                    errors["daily_study_goal_minutes"] = "Daily study goal must be between 5 and 720 minutes."
                else:
                    profile.daily_study_goal_minutes = daily_goal_int
            except (ValueError, TypeError):
                errors["daily_study_goal_minutes"] = "Daily study goal must be a number."

        pref_subjs = body.get("preferred_subjects")
        if pref_subjs is not None:
            if isinstance(pref_subjs, list):
                valid_subjects = [s[0] for s in Note.SUBJECT_CHOICES]
                filtered_subjs = [str(s).strip() for s in pref_subjs if str(s).strip() in valid_subjects]
                profile.preferred_subjects = filtered_subjs
            else:
                errors["preferred_subjects"] = "Preferred subjects must be a list."

        if errors:
            return JsonResponse({"errors": errors}, status=422)

        profile.display_name = display_name
        profile.college = college
        profile.course = course
        profile.semester = semester
        profile.bio = bio
        profile.save()

    # Compute live stats
    total_xp_agg = DailyQuestLog.objects.aggregate(total=Sum("xp_awarded"))
    total_xp = total_xp_agg["total"] or 0
    level_info = _xp_and_level(total_xp)

    LEVEL_TITLES = {
        1: "Apprentice Scholar",
        2: "Dedicated Explorer",
        3: "Knowledge Seeker",
        4: "Master Strategist",
        5: "Academic Champion",
    }
    level_title = LEVEL_TITLES.get(level_info["level"], "Scholar")

    completed_tasks = StudyTask.objects.filter(completed=True).count()
    total_tasks = StudyTask.objects.count()
    total_quizzes = QuizAttempt.objects.count()
    avg_agg = QuizAttempt.objects.aggregate(avg=Avg("percentage"))
    avg_quiz_score = round(avg_agg["avg"]) if avg_agg["avg"] is not None else None
    total_notes = Note.objects.count()
    study_streak = _calculate_study_streak(today)

    available_subjects = [s[0] for s in Note.SUBJECT_CHOICES]

    return JsonResponse({
        "profile": _profile_to_dict(profile),
        "stats": {
            "total_xp": total_xp,
            "level": level_info["level"],
            "level_title": level_title,
            "xp_to_next": level_info["xp_to_next"],
            "progress_pct": level_info["progress_pct"],
            "completed_tasks": completed_tasks,
            "total_tasks": total_tasks,
            "total_quizzes": total_quizzes,
            "avg_quiz_score": avg_quiz_score,
            "total_notes": total_notes,
            "study_streak": study_streak,
        },
        "available_subjects": available_subjects,
    })


@require_http_methods(["POST"])
def reset_profile_defaults(request):
    """
    POST /api/profile/reset/
    Resets profile display fields and preferences to default values without deleting user data.
    """
    profile = StudentProfile.objects.first()
    if not profile:
        profile = StudentProfile.objects.create()
    else:
        profile.display_name = "Niket"
        profile.college = ""
        profile.course = "Computer Science & Engineering"
        profile.semester = "Semester 6"
        profile.bio = "Passionate student focused on mastery and continuous learning."
        profile.preferred_subjects = ["Computer Networks", "Operating Systems", "DBMS"]
        profile.daily_study_goal_minutes = 60
        profile.save()

    return JsonResponse({
        "message": "Profile reset to default values successfully.",
        "profile": _profile_to_dict(profile),
    })


@require_http_methods(["POST"])
def reset_study_history(request):
    """
    POST /api/profile/reset-history/
    Destructive action requiring explicit confirmation in request body: {"confirm": true, "target": "quizzes"|"quests"}
    """
    try:
        body = json.loads(request.body.decode("utf-8"))
    except Exception:
        return JsonResponse({"error": "Invalid JSON."}, status=400)

    if not body.get("confirm"):
        return JsonResponse({"error": "Confirmation required to perform this action."}, status=400)

    target = body.get("target")
    if target == "quizzes":
        count = QuizAttempt.objects.count()
        QuizAttempt.objects.all().delete()
        return JsonResponse({"message": f"Successfully cleared {count} quiz attempt records."})
    elif target == "quests":
        count = DailyQuestLog.objects.count()
        DailyQuestLog.objects.all().delete()
        return JsonResponse({"message": f"Successfully reset {count} quest XP log entries."})
    else:
        return JsonResponse({"error": "Unknown reset target."}, status=400)




