package com.valerio.photocloud

import java.util.Calendar
import java.util.Locale

/**
 * Motore di ricerca in linguaggio naturale 100% on-device (IT/EN) per la galleria Android.
 *
 * Replica la logica di `src/lib/nlSearch.ts` lato server e la estende con i filtri
 * sulle categorie AI on-device (etichette EfficientNet indicizzate in Room):
 *   "foto di agosto 2024", "video anno scorso", "preferiti", "oggi",
 *   "ultimi 7 giorni", "album vacanze", "foto di cani", "ricordi"…
 *
 * Nessuna dipendenza Android: pura logica Kotlin, facilmente testabile.
 */
object NaturalLanguageSearchEngine {

    data class SearchablePhotoItem(
        val filename: String,
        val timestampMs: Long,
        val isMedia: Boolean,
        val isVideo: Boolean,
        val album: String = "",
        val isFavorite: Boolean = false,
        val aiCategories: List<String> = emptyList()
    )

    data class ParsedQuery(
        val textTokens: List<String> = emptyList(),
        val years: List<Int> = emptyList(),
        val months: List<Int> = emptyList(), // 1-12
        val dateFromMs: Long? = null,
        val dateToMs: Long? = null,
        val mediaType: MediaTypeFilter = MediaTypeFilter.ANY,
        val favoritesOnly: Boolean = false,
        val albums: List<String> = emptyList(),
        val aiKeywords: List<String> = emptyList(), // etichette AI cercate (inglese ImageNet)
        val memoriesMode: Boolean = false,
        val explanation: List<String> = emptyList()
    )

    enum class MediaTypeFilter { ANY, PHOTO, VIDEO, FILE }

    private val VIDEO_EXTENSIONS = setOf("mp4", "mov", "webm", "mkv")

    private val MONTH_ALIASES: Map<String, Int> = mapOf(
        "gennaio" to 1, "febbraio" to 2, "marzo" to 3, "aprile" to 4, "maggio" to 5, "giugno" to 6,
        "luglio" to 7, "agosto" to 8, "settembre" to 9, "ottobre" to 10, "novembre" to 11, "dicembre" to 12,
        "gen" to 1, "feb" to 2, "mar" to 3, "apr" to 4, "mag" to 5, "giu" to 6,
        "lug" to 7, "ago" to 8, "set" to 9, "ott" to 10, "nov" to 11, "dic" to 12,
        "january" to 1, "february" to 2, "march" to 3, "april" to 4, "may" to 5, "june" to 6,
        "july" to 7, "august" to 8, "september" to 9, "october" to 10, "november" to 11, "december" to 12,
        "jan" to 1, "sep" to 9, "oct" to 10, "dec" to 12
    )

    private val STOP_WORDS = setOf(
        "di", "del", "della", "dello", "dei", "degli", "delle", "da", "dal", "dai", "dalle", "in", "a", "al",
        "alla", "alle", "e", "ed", "o", "il", "lo", "la", "i", "gli", "le", "un", "una", "uno", "con", "per",
        "su", "tra", "fra", "the", "of", "on", "at", "and", "or", "my", "me", "to", "from", "with",
        "mostra", "mostrami", "trova", "cerca", "vedi", "show", "find", "search", "l'", "d'"
    )

    /**
     * Sinonimi IT/EN → etichette del modello EfficientNet/ImageNet (inglese).
     * Permette query come "foto di cani al mare" senza nessun modello aggiuntivo:
     * sfrutta le categorie già indicizzate on-device da LocalPhotoCategorizer.
     */
    private val AI_KEYWORD_MAP: Map<String, List<String>> = mapOf(
        "mare" to listOf("seashore", "coast", "beach", "ocean", "sandbar", "lakeside"),
        "spiaggia" to listOf("seashore", "beach", "sandbar", "coast"),
        "beach" to listOf("seashore", "beach", "sandbar", "coast"),
        "sea" to listOf("seashore", "coast", "ocean"),
        "montagna" to listOf("alp", "mountain", "cliff", "valley", "volcano", "peak"),
        "mountain" to listOf("alp", "mountain", "cliff", "peak", "volcano"),
        "neve" to listOf("snow", "ski", "snowmobile", "ice"),
        "snow" to listOf("snow", "ski", "snowmobile"),
        "cane" to listOf("dog", "puppy"),
        "cani" to listOf("dog", "puppy"),
        "dog" to listOf("dog", "puppy"),
        "gatto" to listOf("cat", "tabby", "tiger cat", "egyptian cat"),
        "gatti" to listOf("cat", "tabby"),
        "cat" to listOf("cat", "tabby"),
        "cibo" to listOf("pizza", "food", "plate", "restaurant", "sandwich", "ice cream", "banana", "spaghetti"),
        "food" to listOf("pizza", "food", "plate", "sandwich", "restaurant"),
        "tramonto" to listOf("sunset", "sunrise", "sky", "dusk"),
        "sunset" to listOf("sunset", "sunrise", "dusk"),
        "alba" to listOf("sunrise", "sunset", "dawn"),
        "fiori" to listOf("daisy", "flower", "rapeseed", "sunflower", "garden"),
        "flowers" to listOf("daisy", "flower", "sunflower", "garden"),
        "auto" to listOf("sports car", "car", "minivan", "jeep", "limousine", "convertible", "racer"),
        "macchina" to listOf("sports car", "car", "minivan", "jeep", "limousine", "convertible"),
        "car" to listOf("sports car", "car", "minivan", "jeep", "limousine"),
        "moto" to listOf("motorcycle", "moped", "scooter"),
        "bici" to listOf("bicycle", "mountain bike", "tricycle"),
        "bicycle" to listOf("bicycle", "mountain bike"),
        "barca" to listOf("boat", "sailboat", "speedboat", "canoe", "yacht", "pirate"),
        "boat" to listOf("boat", "sailboat", "speedboat", "yacht", "canoe"),
        "aereo" to listOf("airliner", "warplane", "airship", "space shuttle"),
        "airplane" to listOf("airliner", "warplane"),
        "uccello" to listOf("bird", "hummingbird", "owl", "flamingo"),
        "bird" to listOf("bird", "hummingbird", "owl"),
        "persona" to listOf("person", "groom", "bridegroom", "scuba diver", "ballplayer"),
        "persone" to listOf("person", "groom", "ballplayer"),
        "people" to listOf("person", "groom", "ballplayer"),
        "selfie" to listOf("person", "face"),
        "bosco" to listOf("forest", "tree", "lakeside", "valley"),
        "forest" to listOf("forest", "tree", "valley"),
        "citta" to listOf("skyscraper", "street", "cinema", "downtown", "palace", "church"),
        "city" to listOf("skyscraper", "street", "downtown"),
        "campagna" to listOf("valley", "field", "harvester", "hay"),
        "fungo" to listOf("mushroom", "agaric", "bolete"),
        "mushroom" to listOf("mushroom", "agaric"),
        "pianta" to listOf("plant", "flower", "tree", "pot"),
        "animale" to listOf("dog", "cat", "bird", "horse", "zebra", "elephant", "monkey"),
        "animal" to listOf("dog", "cat", "bird", "horse"),
        "cavallo" to listOf("horse", "sorrel"),
        "horse" to listOf("horse", "sorrel"),
        "fuoco" to listOf("fire", "flame", "matchstick", "candle"),
        "fuochi" to listOf("firework", "fire", "candle"),
        "concerto" to listOf("stage", "microphone", "concert", "guitar"),
        "concert" to listOf("stage", "microphone", "guitar"),
        "pioggia" to listOf("rain", "umbrella", "thunder"),
        "ombrello" to listOf("umbrella")
    )

    private fun startOfDayMs(cal: Calendar): Long {
        val c = cal.clone() as Calendar
        c.set(Calendar.HOUR_OF_DAY, 0)
        c.set(Calendar.MINUTE, 0)
        c.set(Calendar.SECOND, 0)
        c.set(Calendar.MILLISECOND, 0)
        return c.timeInMillis
    }

    fun parse(rawQuery: String, nowMs: Long = System.currentTimeMillis()): ParsedQuery {
        val explanation = mutableListOf<String>()
        var text = " ${rawQuery.lowercase(Locale.ITALIAN)} "
            .replace(Regex("[àáâã]"), "a")
            .replace(Regex("[èéêë]"), "e")
            .replace(Regex("[ìíî]"), "i")
            .replace(Regex("[òóôõ]"), "o")
            .replace(Regex("[ùúû]"), "u")
            .replace(Regex("[^a-z0-9' ]+"), " ")
            .replace(Regex("\\s+"), " ")
            .trim()
        if (text.isBlank()) return ParsedQuery()

        val nowCal = Calendar.getInstance().apply { timeInMillis = nowMs }
        val todayStart = startOfDayMs(nowCal)
        val dayMs = 86_400_000L

        var favoritesOnly = false
        var mediaType = MediaTypeFilter.ANY
        var memoriesMode = false
        val years = linkedSetOf<Int>()
        val months = linkedSetOf<Int>()
        val albums = mutableListOf<String>()
        val aiKeywords = linkedSetOf<String>()
        val textTokens = mutableListOf<String>()
        var dateFrom: Long? = null
        var dateTo: Long? = null

        // Frasi multi-parola temporali
        val multiWord = listOf(
            Regex("\\bquesta settimana\\b|\\bthis week\\b") to ("settimana corrente" to {
                dateFrom = todayStart - 6 * dayMs; dateTo = todayStart + dayMs - 1
            }),
            Regex("\\bsettimana scorsa\\b|\\blast week\\b") to ("settimana scorsa" to {
                dateFrom = todayStart - 13 * dayMs; dateTo = todayStart - 7 * dayMs + dayMs - 1
            }),
            Regex("\\bquesto mese\\b|\\bthis month\\b") to ("mese corrente" to {
                months.add(nowCal.get(Calendar.MONTH) + 1); years.add(nowCal.get(Calendar.YEAR))
            }),
            Regex("\\bmese scorso\\b|\\blast month\\b") to ("mese scorso" to {
                val c = nowCal.clone() as Calendar; c.add(Calendar.MONTH, -1)
                months.add(c.get(Calendar.MONTH) + 1); years.add(c.get(Calendar.YEAR))
            }),
            Regex("\\bquest'anno\\b|\\bquesto anno\\b|\\bthis year\\b") to ("anno corrente" to {
                years.add(nowCal.get(Calendar.YEAR))
            }),
            Regex("\\banno scorso\\b|\\blast year\\b") to ("anno scorso" to {
                years.add(nowCal.get(Calendar.YEAR) - 1)
            }),
            Regex("\\boggi\\b|\\btoday\\b") to ("oggi" to {
                dateFrom = todayStart; dateTo = todayStart + dayMs - 1
            }),
            Regex("\\bieri\\b|\\byesterday\\b") to ("ieri" to {
                dateFrom = todayStart - dayMs; dateTo = todayStart - 1
            }),
            Regex("\\bricordi\\b|\\bmemories\\b|\\bon this day\\b") to ("ricordi" to {
                memoriesMode = true
            })
        )
        for ((re, pair) in multiWord) {
            val (label, apply) = pair
            if (re.containsMatchIn(text)) {
                apply()
                explanation.add(label)
                text = text.replace(re, " ")
            }
        }
        val lastNDays = Regex("\\b(?:ultimi|ultime)\\s+(\\d{1,3})\\s+giorni\\b").find(text)
            ?: Regex("\\blast\\s+(\\d{1,3})\\s+days\\b").find(text)
        if (lastNDays != null) {
            val n = lastNDays.groupValues[1].toIntOrNull()?.coerceIn(1, 3650) ?: 7
            dateFrom = todayStart - (n - 1) * dayMs
            dateTo = todayStart + dayMs - 1
            explanation.add("ultimi $n giorni")
            text = text.replace(lastNDays.value, " ")
        }

        // album <nome>
        val albumMatch = Regex("\\balbum\\s+([a-z0-9][a-z0-9 _-]{0,60})").find(text)
        if (albumMatch != null) {
            val name = albumMatch.groupValues[1].trim().split(Regex("\\s+")).take(6).joinToString(" ")
            if (name.isNotBlank()) {
                albums.add(name)
                explanation.add("album \"$name\"")
                text = text.replace(albumMatch.value, " ")
            }
        }

        for (rawToken in text.split(" ")) {
            val token = rawToken.trim('\'')
            if (token.isBlank()) continue
            when {
                token.matches(Regex("^(19|20)\\d{2}$")) -> {
                    years.add(token.toInt()); explanation.add("anno $token")
                }
                MONTH_ALIASES[token] != null -> {
                    months.add(MONTH_ALIASES[token]!!); explanation.add("mese ${MONTH_ALIASES[token]}")
                }
                token in listOf("foto", "photo", "photos", "immagini", "immagine", "picture", "pictures", "image", "images") -> {
                    mediaType = MediaTypeFilter.PHOTO; explanation.add("solo foto")
                }
                token in listOf("video", "videos", "filmato", "filmati", "clip") -> {
                    mediaType = MediaTypeFilter.VIDEO; explanation.add("solo video")
                }
                token in listOf("file", "documento", "documenti", "document", "documents", "pdf", "doc", "docs") -> {
                    mediaType = MediaTypeFilter.FILE; explanation.add("solo file cloud")
                }
                token in listOf("preferiti", "preferito", "favorite", "favorites", "favourites", "starred", "stella") -> {
                    favoritesOnly = true; explanation.add("solo preferiti")
                }
                STOP_WORDS.contains(token) -> {}
                else -> {
                    val mapped = AI_KEYWORD_MAP[token]
                    if (mapped != null) {
                        aiKeywords.addAll(mapped)
                        explanation.add("AI: $token")
                    }
                    if (mapped == null || token.length >= 4) {
                        textTokens.add(token)
                    }
                }
            }
        }

        return ParsedQuery(
            textTokens = textTokens.distinct(),
            years = years.toList(),
            months = months.toList(),
            dateFromMs = dateFrom,
            dateToMs = dateTo,
            mediaType = mediaType,
            favoritesOnly = favoritesOnly,
            albums = albums,
            aiKeywords = aiKeywords.toList(),
            memoriesMode = memoriesMode,
            explanation = explanation
        )
    }

    private fun extension(filename: String): String =
        filename.substringAfterLast('.', "").lowercase(Locale.ROOT)

    fun matches(item: SearchablePhotoItem, q: ParsedQuery, nowMs: Long = System.currentTimeMillis()): Boolean {
        if (q.favoritesOnly && !item.isFavorite) return false

        when (q.mediaType) {
            MediaTypeFilter.PHOTO -> if (!item.isMedia || item.isVideo) return false
            MediaTypeFilter.VIDEO -> if (!item.isMedia || !VIDEO_EXTENSIONS.contains(extension(item.filename))) return false
            MediaTypeFilter.FILE -> if (item.isMedia) return false
            MediaTypeFilter.ANY -> {}
        }

        if (q.dateFromMs != null && q.dateToMs != null) {
            if (item.timestampMs < q.dateFromMs || item.timestampMs > q.dateToMs) return false
        }

        val itemCal = Calendar.getInstance().apply { timeInMillis = item.timestampMs }
        if (q.years.isNotEmpty() && !q.years.contains(itemCal.get(Calendar.YEAR))) return false
        if (q.months.isNotEmpty() && !q.months.contains(itemCal.get(Calendar.MONTH) + 1)) return false

        if (q.memoriesMode) {
            val nowCal = Calendar.getInstance().apply { timeInMillis = nowMs }
            val sameDay = itemCal.get(Calendar.MONTH) == nowCal.get(Calendar.MONTH) &&
                itemCal.get(Calendar.DAY_OF_MONTH) == nowCal.get(Calendar.DAY_OF_MONTH)
            if (!sameDay || itemCal.get(Calendar.YEAR) >= nowCal.get(Calendar.YEAR)) return false
        }

        if (q.albums.isNotEmpty()) {
            val albumLower = item.album.lowercase(Locale.ITALIAN)
            if (!q.albums.all { albumLower.contains(it) }) return false
        }

        if (q.aiKeywords.isNotEmpty()) {
            val cats = item.aiCategories.map { it.lowercase(Locale.ENGLISH) }
            val anyMatch = q.aiKeywords.any { kw -> cats.any { it.contains(kw) } }
            if (!anyMatch) return false
        }

        if (q.textTokens.isNotEmpty()) {
            val haystack = "${item.filename} ${item.album}".lowercase(Locale.ITALIAN)
            if (!q.textTokens.all { haystack.contains(it) }) return false
        }

        return true
    }

    fun filter(
        items: List<SearchablePhotoItem>,
        rawQuery: String,
        nowMs: Long = System.currentTimeMillis()
    ): List<SearchablePhotoItem> {
        val parsed = parse(rawQuery, nowMs)
        if (rawQuery.isBlank()) return items
        return items.filter { matches(it, parsed, nowMs) }
    }
}
