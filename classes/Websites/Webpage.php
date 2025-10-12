<?php

use HeadlessChromium\BrowserFactory;

/**
 * @module Websites
 */
/**
 * Class for dealing with websites webpage
 * 
 * @class Websites_Webpage
 */
class Websites_Webpage extends Base_Websites_Webpage
{
	/**
	 * Get URL, load page and crape info to array
	 * @method scrape
	 * @static
	 * @param string $url Page source to load
	 * @throws Q_Exception
	 * @return array
	 */
	static function scrape($url)
	{
		$parts = explode('#', $url);
		$url = reset($parts);
		$originalUrl = $url;

		// add scheme to url if not exist
		if (parse_url($url, PHP_URL_SCHEME) === null) {
			$url = 'http://'.$url;
		}

		if (!Q_Valid::url($url)) {
			throw new Exception("Invalid URL");
		}

		$parsedUrl = parse_url($url);
		$host = $parsedUrl["host"];
		$port = Q::ifset($parsedUrl, "port", null);

		$result = array(
			'host' => $host,
			'port' => $port
		);

		//$document = file_get_contents($url);

        // try to get cache
		$cached = self::cacheGet($originalUrl);
		if (!$cached) {
			if (substr($url, -1) === '/') {
				$cached = self::cacheGet(substr($originalUrl, 0, -1));
			} else {
				$cached = self::cacheGet($originalUrl.'/');
			}
		}
		if ($cached) {
			return $cached;
		}

		$headers = get_headers($url, 1);
		if ($headers) {
			for ($i=0; $i<5; ++$i) {
				if ($header = Q::ifset($headers, 0, '')
				and (preg_match('/HTTP.*\ 301/', $header)
				     or preg_match('/HTTP.*\ 302/', $header))) {
					// Do up to 5 redirects
					if (empty($headers['Location'])) {
						throw new Q_Exception("Redirect to empty location");
					}
					$url = self::normalizeHref(
						is_array($headers['Location'])
							? end($headers['Location'])
							: $headers['Location'],
						$url
					);
					$headers = get_headers($url, 1);
				} else {
					break;
				}
			}
			$headers = array_change_key_case($headers, CASE_LOWER);
			if (is_array($headers['content-type'])) {
				$contentType = end($headers['content-type']);
			} else {
				$contentType = $headers['content-type'];
			}
		} else {
			$contentType = "text/html";
		}

        // for non text/html content use another approach
        if (!stristr($contentType, 'text/html')) {
            $fileInfo = self::getRemoteFileInfo($url);

            $extension = Q::ifset($fileInfo, 'fileformat', Q::ifset($fileInfo, 'mime_type', strtolower(pathinfo($url, PATHINFO_EXTENSION))));
            $extension = preg_replace("/.*\//", '', $extension);

            // check if this extension exist in Streams/files/Streams/icons/files
            $dirname = STREAMS_PLUGIN_FILES_DIR.DS.'Streams'.DS.'icons'.DS.'files';
            $urlPrefix = '{{Streams}}/img/icons/files';
            $icon = file_exists($dirname.DS.$extension)
                ? "$urlPrefix/$extension/80.png"
                : "$urlPrefix/_blank/80.png";


            $result = array_merge($result, array(
                'title' => Q::ifset($fileInfo, 'comments', 'name', null),
                'url' => $url,
                'iconBig' => $icon,
                'iconSmall' => $icon,
                'type' => $extension
            ));

            return self::_returnScrape($originalUrl, $url, $result);
        }

		// If http response header mentions that content is gzipped, then uncompress it
		$gzip = false;
		foreach ($http_response_header as $item) {
			if(stristr($item, 'content-encoding') && stristr($item, 'gzip')) {
				//Now lets uncompress the compressed data
				$gzip = true;
				$document = file_get_contents($url);
				$document = gzinflate(substr($document,10,-8) );
				break;
			}
		}
		if (!$gzip) {
			$document = Q_Utils::get($url, null, array(
				CURLOPT_SSL_VERIFYPEER => false,
				CURLOPT_SSL_VERIFYHOST => false
			));
			if (!$document) {
				throw new Exception("Unable to access the site");
			}
		}

		$doc = new DOMDocument();
		// set error level
		$internalErrors = libxml_use_internal_errors(true);
		$encoded = mb_encode_numericentity($document, array(0x80, 0x10FFFF, 0, ~0), 'UTF-8' );
		$doc->loadHTML($encoded);
		// Restore error level
		libxml_use_internal_errors($internalErrors);

		$xpath = new DOMXPath($doc);
		$query = $xpath->query('//*/meta');

		// get metas
		$ogMetas = array();
		$metas = array();
		foreach ($query as $item) {
			$name = $item->getAttribute('name');
			$content = $item->getAttribute('content');
			$property = $item->getAttribute('property');

			if(!empty($property) && preg_match('#^og:#', $property)) {
				$ogMetas[str_replace("og:", "", $property)] = $content;
			} elseif(!empty($name)) {
				$metas[$name] = $content;
			}
		}

		$result = array_merge($result, $metas, $ogMetas);

		$result['headers'] = array();

		// merge headers into string
		foreach ($headers as $key => $item) {
			if (is_array($item)) {
				$item = end($item);
			}
			$result['headers'][trim($key)] = trim($item);
		}

		// collect language from diff metas
		$result['lang'] = Q::ifset($result, 'language', Q::ifset(
			$result, 'lang', Q::ifset($result, 'locale', null)
		));

		// if language empty, collect from html tag or headers
		if (empty($result['lang'])) {
			// get title
			$html = $doc->getElementsByTagName("html");
			if($html->length > 0){
				$result['lang'] = $html->item(0)->getAttribute('lang');
			}

			if (empty($result['lang'])) {
				$result['lang'] = Q::ifset($result, 'headers', 'language', Q::ifset($result, 'headers', 'content-language', 'en'));
			}
		}

		// get title
		$titleNode = $xpath->query('//title')->item(0);
		$result['title'] = $titleNode ? $titleNode->textContent : 'Untitled Webpage';

		$elements = $xpath->query('//*/link');
		$icons = array();
		$canonicalUrl = null;
		foreach ($elements as $element) {
			$rel = strtolower($element->getAttribute('rel'));
			$href = $element->getAttribute('href');

			if(!empty($rel)){
				if (preg_match('#icon#', $rel)) {
					$icons[$rel] = self::normalizeHref($href, $url);
				}

				if ($rel == 'canonical') {
					$canonicalUrl = self::normalizeHref($href, $url);
				}
			}
		}

		$elements = $xpath->query('//*/meta');
		foreach ($elements as $element) {
			$itemprop = strtolower($element->getAttribute('itemprop'));
			$metaname = strtolower($element->getAttribute('name'));
			if ($itemprop === 'image'
			or strpos($metaname, ':image') !== false) {
				$href = $element->getAttribute('content');
				if (!$href) {
					$href = $element->getAttribute('value');
				}
				$result['image'] = self::normalizeHref($href, $url);
			}
		}

		// parse url
		$result['url'] = $canonicalUrl ? $canonicalUrl : $url;

		// get big icon
		$icon = Q::ifset($result, 'image', null);
		$bigIconAllowedMetas = array( // search icon among <link> with these "rel"
			'apple-touch-icon',
			'apple-touch-icon-precomposed',
			'image'
		);
		if (Q_Valid::url($icon)) {
			$result['iconBig'] = $icon;
		} else {
			foreach ($bigIconAllowedMetas as $item) {
				if ($item = Q::ifset($icons, $item, null)) {
					$result['iconBig'] = $item;
					break;
				}
			}
		}

		// get small icon
		$result['iconSmall'] = $result['iconBig']; // default
		$smallIconAllowedMetas = array( // search icon among <link> with these "rel"
			'icon',
			'shortcut icon'
		);
		foreach ($smallIconAllowedMetas as $item) {
			if ($item = Q::ifset($icons, $item, null)) {
				$result['iconSmall'] = $item;
				break;
			}
		}

		// as we don't support SVG images in Users::importIcon, try to select another image
		// when we start support SVG, just remove these blocks
		if (!empty($result['iconBig'])
		and pathinfo($result['iconBig'], PATHINFO_EXTENSION) == 'svg') {
			reset($bigIconAllowedMetas);
			foreach ($bigIconAllowedMetas as $item) {
				$item = Q::ifset($icons, $item, null);
				if ($item && pathinfo($item, PATHINFO_EXTENSION) != 'svg') {
					$result['iconBig'] = $item;
					break;
				}
			}
		}
		if (!empty($result['iconSmall'])
		and pathinfo($result['iconSmall'], PATHINFO_EXTENSION) == 'svg') {
			reset($smallIconAllowedMetas);
			foreach ($smallIconAllowedMetas as $item) {
				$item = Q::ifset($icons, $item, null);
				if ($item && pathinfo($item, PATHINFO_EXTENSION) != 'svg') {
					$result['iconSmall'] = $item;
					break;
				}
			}
		}
		//---------------------------------------------------------------

		// if big icon empty, set it to small icon
		if (empty($result['iconBig']) && !empty($result['iconSmall'])) {
			$result['iconBig'] = $result['iconSmall'];
		}

		$result['iconBig'] = self::normalizeHref($result['iconBig'], $url);
		$result['iconSmall'] = self::normalizeHref($result['iconSmall'], $url);

		// additional handler for youtube.com
		if (in_array($host, array('www.youtube.com', 'youtube.com'))) {
			preg_match("/^(?:http(?:s)?:\/\/)?(?:www\.)?(?:m\.)?(?:youtu\.be\/|youtube\.com\/(?:(?:watch)?\?(?:.*&)?v(?:i)?=|(?:embed|v|vi|user|shorts)\/))([^\?&\"'>]+)/u", $url, $videoId);
			$videoId = end($videoId);
			$youtubeData = self::youtube(@compact("videoId"));
			$youtubeData  = reset($youtubeData);
			$result = array_merge($result, $youtubeData);
		}

		$result['iconBig'] = Q::ifset($result, 'iconBig', Q_Uri::interpolateUrl("{{baseUrl}}/{{Websites}}/img/icons/Websites/webpage/80.png"));
		$result['iconSmall'] = Q::ifset($result, 'iconSmall', Q_Uri::interpolateUrl("{{baseUrl}}/{{Websites}}/img/icons/Websites/webpage/40.png"));

		return self::_returnScrape($originalUrl, $url, $result);
	}

	private static function _returnScrape ($originalUrl, $url, $result) {
		Websites_Webpage::cacheSet($originalUrl, $result);
		if ($url !== $originalUrl) {
			Websites_Webpage::cacheSet($url, $result);
		}
		return $result;
	}

	/**
	 * Get search youtube videos or get info about video.
	 * @method youtube
	 * @static
	 * @param {array} $options
	 * @param {string} [$options.videoId] id of youtube video to get info about single video
	 * @param {string|array} [$options.query] If string - query string to search videos. If array - replace ytQuery object.
	 * @param {string} [$options.channel] youtube channel id
	 * @param {integer} [$options.maxResults=10] limit search results
	 * @param {string} [$options.order=date] Results order by.
	 * @param {boolean} [$options.pureResult=false] If true, return exactly result got from youtube API
	 * @param {integer} [$options.cacheDuration] response cache life time in seconds
	 * @return {array|boolean} decoded json if found or false
	 */
	static function youtube ($options) {
		$apiKey = Q_Config::expect("Websites", "youtube", "keys", "server");
		$videoId = Q::ifset($options, "videoId", null);
		$query = Q::ifset($options, "query", null);
		$pureResult = Q::ifset($options, "pureResult", false);

		if ($videoId === null && $query === null) {
			throw new Exception('Websites_Webpage::youtube: videoId or query should defined');
		}

		$type = $videoId ? "videos" : "search";
		$endPoint = "https://youtube.googleapis.com/youtube/v3/".$type;

		$ytQuery = is_array($query) ? $query : array(
			"part" => "snippet"
		);

		if ($type == "search") {
			$ytQuery["maxResults"] = Q::ifset($options, "maxResults", 10);
			$ytQuery["order"] = Q::ifset($options, "order", "date");
			if (is_string($query)) {
				$ytQuery["q"] = $query;
			}

			$channelId = Q::ifset($options, "channel", null);
			if ($channelId) {
				$ytQuery["channelId"] = $channelId;
			}
		} elseif ($type == "videos") {
			$ytQuery["id"] = $videoId;
		}

		if (!function_exists('returnYoutube')) {
			function returnYoutube ($data, $pureResult) {

				if ($pureResult) {
					return $data;
				}

				$results = array();

				foreach ($data["items"] as $item) {
					$snippet = $item["snippet"];

					$tags = Q::ifset($snippet, 'tags', null);
					$keywords = "";
					if (is_array($tags) && count($tags)) {
						$keywords = implode(',', $tags);
					}
					$videoId = Q::ifset($item, "id", "videoId", Q::ifset($item, "id", null));
					if (!is_string($videoId)) {
						continue;
					}
					$result = array(
						"title" => $snippet["title"],
						"icon" => Q::ifset($snippet, "thumbnails", "default", "url", null),
						"iconBig" => Q::ifset($snippet, "thumbnails", "high", "url", null),
						"iconSmall" => "{{Websites}}/img/icons/Websites/youtube/32.png",
						"description" => $snippet["description"],
						"keywords" => $keywords,
						"publishTime" => strtotime(Q::ifset($snippet, "publishTime", Q::ifset($snippet, "publishedAt", "now"))),
						"url" => "https://www.youtube.com/watch?v=$videoId"
					);

					// cache data for video
					Websites_Webpage::cacheSet($result["url"], $result);

					$results[] = $result;
				}

				return $results;
			}
		}

		$cacheUrl = $endPoint.'?'.http_build_query($ytQuery);

		// check for cache
		$cached = Websites_Webpage::cacheGet($cacheUrl);
		if ($cached) {
			return returnYoutube($cached, $pureResult);
		}

		$ytQuery["key"] = $apiKey;

		// docs: https://developers.google.com/youtube/v3/docs/search/list
		$youtubeApiUrl = $endPoint.'?'.http_build_query($ytQuery);
		$result = Q::json_decode(Q_Utils::get($youtubeApiUrl), true);
		if (Q::ifset($result, "error", null)) {
			throw new Exception("Youtube API error: ".Q::ifset($result, "error", "message", null));
		}
		$cacheDuration = $type == "search" ? Q::ifset($options, "cacheDuration", Q_Config::get("Websites", "youtube", "list", "cacheDuration", 43200)) : null; // for youtube search results cache duration 12 hours
		Websites_Webpage::cacheSet($cacheUrl, $result, $cacheDuration);

		return returnYoutube($result, $pureResult);
	}
	/**
	 * Get cached url response
	 * @method cacheGet
	 * @static
	 * @param string $url
	 * @return array|boolean decoded json if found or false
	 */
	static function cacheGet ($url) {
		if (!Q_Config::get('Websites', 'cache', 'webpage', true)) {
			return false;
		}

		$webpageCache = new Websites_Webpage();
		$webpageCache->url = $url;
		if (!$webpageCache->retrieve()) {
			// if not retrieved try to find url ended with slash (to avoid duplicates of save source)
			$webpageCache->url = $url.'/';
			$webpageCache->retrieve();
		}

		if ($webpageCache->retrieved) {
			$updatedTime = $webpageCache->updatedTime;
			if (isset($updatedTime)) {
				$db = $webpageCache->db();
				$updatedTime = $db->fromDateTime($updatedTime);
				$currentTime = $db->getCurrentTimestamp();
				$cacheDuration = $webpageCache->duration; // default 1 month
				if ($currentTime - $updatedTime < $cacheDuration) {
					// there are cached webpage results that are still viable
					return json_decode($webpageCache->results, true);
				} else {
					$webpageCache->remove();
				}
			}
		}

		return false;
	}
	/**
	 * Save url response to cache
	 * @method cacheSet
	 * @static
	 * @param string $url
	 * @param array $result
	 * @param integer [$duration=null] cache life time in seconds
	 */
	static function cacheSet ($url, $result, $duration = null) {
		// check if already exists
		if (self::cacheGet($url)) {
			return;
		}

		$webpageCache = new Websites_Webpage();
		$webpageCache->url = $url;

		if ($duration) {
			$webpageCache->duration = $duration;
		}

		// dummy interest block for cache
		$result['interest'] = array(
			'title' => $url,
			'icon' => Q::ifset($result, "iconSmall", Q::ifset($result, "icon", Q::ifset($result, "iconBig", null)))
		);
		$webpageCache->results = json_encode($result);
		$webpageCache->save();
	}
	/**
	 * Normalize href like '//path/to' or '/path/to' to valid URL
	 * @method normalizeHref
	 * @static
	 * @param string $href
	 * @param string $baseUrl
	 * @throws Exception
	 * @return string
	 */
	static function normalizeHref ($href, $baseUrl) {
		$parts = parse_url($baseUrl);

		if (preg_match("#^\\/\\/#", $href)) {
			return $parts['scheme'].':'.$href;
		}

		if (preg_match("#^\\/#", $href)) {
			return $parts['scheme'] . '://' . $parts['host'] . $href;
		}

		if (!Q_Valid::url($href)) {
			return $parts['scheme'] . '://' . $parts['host'] . '/' . $href;
		}

		if (substr($baseUrl, -1) === '/') {
			$baseUrl = substr($baseUrl, 0, -1);
		}
		if (preg_match("#^.\\/#", $href)) {
			return $baseUrl . '/' . substr($href, 2);
		}

		return $href;
	}
	/**
	 * Normalize url to use as part of stream name like Websites/webpage/[normalized]
	 * @method normalizeUrl
	 * @static
	 * @param {string} $url
	 * @return string
	 */
	static function normalizeUrl($url) {
		// we have "name" field max size 255, Websites/webpage/ = 18 chars
		return substr(Q_Utils::normalize($url), 0, 230);
	}
	/**
	 * If Websites/webpage stream for this $url already exists - return one.
	 * @method fetchStream
	 * @static
	 * @param {string} $url URL string to search stream by.
     * @param {string} [$streamType=null] Type of stream to search. If null it auto detected with getStreamType method.
	 * @return Streams_Stream
	 */
	static function fetchStream($url, $streamType = null) {
        if (!$streamType) {
            $streamType = self::getStreamType($url);
        }

		$streams = new Streams_Stream();
		$streams->name = $streamType.'/'.self::normalizeUrl($url);
		if ($streams->retrieve()) {
			return Streams_Stream::fetch($streams->publisherId, $streams->publisherId, $streams->name);
		}

		$streams->name .= '_';
		if ($streams->retrieve()) {
			return Streams_Stream::fetch($streams->publisherId, $streams->publisherId, $streams->name);
		}

		return null;
	}
    /**
     * Get stream type from url
     * @method getType
     * @static
     * @param {string} $url
     * @return String
     */
	static function getStreamType ($url) {
        $parsed = parse_url($url);
        $host = Q::ifset($parsed, 'host', null);

        $path_info = pathinfo($url);
        $extension = Q::ifset($path_info, 'extension', '');

        $videoHosts = Q_Config::get("Websites", "videoHosts", array());
        $videoExtensions = Q_Config::get("Websites", "videoExtensions", array());

        $audioHosts = Q_Config::get("Websites", "audioHosts", array());
        $audioExtensions = Q_Config::get("Websites", "audioExtensions", array());

        if (false !== Q::striposa($host, $videoHosts) || false !== Q::striposa($extension, $videoExtensions)) {
            return 'Streams/video';
        } elseif (false !== Q::striposa($host, $audioHosts) || false !== Q::striposa($extension, $audioExtensions)) {
            return 'Streams/audio';
        }

        return 'Websites/webpage';
    }
	/**
	 * Get limited data from remote url
	 * @method readURL
	 * @static
	 * @param {string} $url
	 * @param {integer} [$dataLimit=65536] Limit data length (bites) to download. Default 64Kb.
	 * @throws Q_Exception
	 * @return string
	 */
	static function readURL ($url, $dataLimit = 65536) {
		if (!$urlp = fopen($url, "r")) {
			throw new Q_Exception('Error opening URL for reading');
		}

		$data = null;

		try {
			$chunk_size = 4096; // Haven't bothered to tune this, maybe other values would work better??
			$got = 0;

			// Grab the first 64 KB of the file	
			while(!feof($urlp) && $got < $dataLimit) {
				$data = $data . fgets($urlp, $chunk_size);
				$got = strlen($data);
			}

			// Now $fp should be the first and last 64KB of the file!!
			@fclose($urlp);
		} catch (Exception $e) {
			@fclose($urlp);
			throw new Q_Exception('Error reading remote file using fopen');
		}

		return $data;
	}
    /**
     * Get meta data from remote file by url
     * @method getRemoteFileInfo
     * @static
     * @param {string} $url
     * @param {integer} [$dataLimit=65536] Limit data length (bites) to download. Default 64Kb.
	 * @param {boolean} [$closeFile=true] Whether to remove temp file after method executed
     * @throws Q_Exception
     * @return {array} Array of "name", "comments", "fileHandler"
     */
    static function getRemoteFileInfo ($url, $dataLimit = 65536, $closeFile = true) {
        if (!$urlp = fopen($url, "r")) {
            throw new Q_Exception('Error opening URL for reading');
        }
        $file = tmpfile();
        $data = stream_get_meta_data($file);
		$path = $data['uri'];
        try {
            $chunk_size = 4096; // Haven't bothered to tune this, maybe other values would work better??
            $got = 0; $data = null;

            // Grab the first 64 KB of the file
            while(!feof($urlp) && $got < $dataLimit) {
                $data = $data . fgets($urlp, $chunk_size);
                $got = strlen($data);
            }
            fwrite($file, $data);  // Grab the last 64 KB of the file, if we know how big it is.  if ($size > 0) {

            // Now $fp should be the first and last 64KB of the file!!
            @fclose($urlp);
        } catch (Exception $e) {
            @fclose($file);
            @fclose($urlp);
            throw new Q_Exception('Error reading remote file using fopen');
        }

        $getID3 = new Audio_getID3();
        $metaData = $getID3->analyze($path);
        getid3_lib::CopyTagsToComments($metaData);

        $title = Q::ifset($metaData, 'comments', 'title', 0, null);
        $artist = Q::ifset($metaData, 'comments', 'artist', 0, null);

        $name = ($artist ? $artist.': ' : '') . $title;

        if ($name) {
            $metaData['comments']['name'] = $name;
        } else {
            // try to get name from headers
            $headers = get_headers($url, 1);
            $contentDisposition = $headers["Content-Disposition"];
            $fileName = self::getFilenameFromDisposition($contentDisposition);
            if ($fileName) {
                $name = pathinfo($fileName, PATHINFO_FILENAME);
            }

            if ($name) {
                $metaData['comments']['name'] = $name;
            } else {
                // try to get name from url string
                $name = pathinfo($url, PATHINFO_FILENAME);
                if ($name) {
                    $metaData['comments']['name'] = $name;
                } else {
                    $metaData['comments']['name'] = null;
                }
            }
        }

        if ($closeFile) {
			@fclose($file);
		} else {
			$metaData['fileHandler'] = $file;
		}

        return $metaData;
    }
    /**
     * Get file name from Content-Disposition header raw
     * @method getFilenameFromDisposition
     * @static
     * @param {string} $contentDisposition
     * @return string
     */
    static function getFilenameFromDisposition ($contentDisposition) {
        // Get the filename.
        $filename = null;

        $value = trim( $contentDisposition );

        if ( strpos( $value, ';' ) === false ) {
            return null;
        }

        list( $type, $attr_parts ) = explode( ';', $value, 2 );

        $attr_parts = explode( ';', $attr_parts );
        $attributes = array();

        foreach ( $attr_parts as $part ) {
            if ( strpos( $part, '=' ) === false ) {
                continue;
            }

            list( $key, $value ) = explode( '=', $part, 2 );

            $attributes[ trim( $key ) ] = trim( $value );
        }

        if ( empty( $attributes['filename'] ) ) {
            return null;
        }

        $filename = trim( $attributes['filename'] );

        // Unquote quoted filename, but after trimming.
        if ( substr( $filename, 0, 1 ) === '"' && substr( $filename, -1, 1 ) === '"' ) {
            $filename = substr( $filename, 1, -1 );
        }

        return $filename;
    }
	/**
	 * Create Websites/webpage stream from params
	 * May return existing stream for this url (fetched without acceess checks)
	 * @method createStream
	 * @static
	 * @param {array} $params
	 * @param {string} [$params.asUserId=null] The user who would be create stream. If null - logged user id.
	 * @param {string} [$params.publisherId=null] Stream publisher id. If null - logged in user.
	 * @param {string} [$params.url]
	 * @param {string} [quotaName='Websites/webpage/chat'] Default quota name. Can be:
	 * 	Websites/webpage/conversation - create Websites/webpage stream for conversation about webpage
	 * 	Websites/webpage/chat - create Websites/webpage stream from chat to cache webpage.
	 * @param {bool} [$skipAccess=false] Whether to skip access in Streams::create and quota checking.
	 * @throws Exception
	 * @return Streams_Stream
	 */
	static function createStream ($params, $quotaName='Websites/webpage/chat', $skipAccess=false) {
		$url = Q::ifset($params, 'url', null);
		
		// add scheme to url if not exist
		if (parse_url($url, PHP_URL_SCHEME) === null) {
			$url = 'http://'.$url;
		}

		if (!Q_Valid::url($url)) {
			throw new Exception("Invalid URL");
		}

		$siteData = self::scrape($url);

		$urlParsed = parse_url($url);
		$loggedUserId = Users::loggedInUser(true)->id;

		$asUserId = Q::ifset($params, "asUserId", $loggedUserId);
		$publisherId = Q::ifset($params, "publisherId", $loggedUserId);

		$streamType = self::getStreamType($url);

		// check if stream for this url has been already created
		// and if yes, return it
		if ($webpageStream = self::fetchStream($url)) {
			return $webpageStream;
		}

		$quota = null;
		if (!$skipAccess) {
			// check quota
			$roles = Users::roles();
			$quota = Users_Quota::check($asUserId, '', $quotaName, true, 1, array_keys($roles));
		}

		$streamsStream = new Streams_Stream();
		$title = Q::ifset($siteData, 'title', substr($url, strrpos($url, '/') + 1));
		$title = $title ? mb_substr($title, 0, $streamsStream->maxSize_title(), "UTF-8") : '';

		$keywords = Q::ifset($siteData, 'keywords', null);
		$description = mb_substr(Q::ifset($siteData, 'description', ''), 0, $streamsStream->maxSize_content(), "UTF-8");
		$copyright = Q::ifset($siteData, 'copyright', null);
		$iconBig = self::normalizeHref(Q::ifset($siteData, 'iconBig', null), $url);
		$iconSmall = self::normalizeHref(Q::ifset($siteData, 'iconSmall', null), $url);
		$contentType = Q::ifset($siteData, 'headers', 'Content-Type', 'text/html'); // content type by default text/html
		$contentType = explode(';', $contentType)[0];
		$streamIcon = null;

		// special interest stream for websites/webpage stream
		$port = Q::ifset($urlParsed, 'port', null);
		$host = $urlParsed['host'];
		$interestTitle = 'Websites: '.$host.($port ? ':'.$port : '');
		// insofar as user created Websites/webpage stream, need to complete all actions related to interest created from client
		Q::event('Streams/interest/post', array(
			'title' => $interestTitle,
			'userId' => $publisherId
		));
		$interestPublisherId = Q_Response::getSlot('publisherId');
		$interestStreamName = Q_Response::getSlot('streamName');

		$interestStream = Streams_Stream::fetch(null, $interestPublisherId, $interestStreamName);

		if ($contentType != 'text/html') {
			// trying to get icon
			Q_Config::load(WEBSITES_PLUGIN_CONFIG_DIR.DS.'mime-types.json');
			$extension = Q_Config::get('mime-types', $contentType, '_blank');
			$urlPrefix = '{{baseUrl}}/{{Streams}}/img/icons/files';
			$streamIcon = file_exists(STREAMS_PLUGIN_FILES_DIR.DS.'Streams'.DS.'icons'.DS.'files'.DS.$extension)
				? "$urlPrefix/$extension"
				: "$urlPrefix/_blank";
		}

		// set icon for interest stream
		if ($interestStream instanceof Streams_Stream
		&& !Users::isCustomIcon($interestStream->icon)) {
			$result = null;

			if (Q_Valid::url($iconSmall)) {
				try {
					if (pathinfo($iconSmall, PATHINFO_EXTENSION) == 'svg') {
						$directory = $interestStream->iconDirectory();
						Q_Utils::canWriteToPath($directory, null, true);
						$fileName = $directory.DS.'icon.svg';
						file_put_contents($fileName, file_get_contents($iconSmall));
						$head = APP_FILES_DIR.DS.Q::app().DS.'uploads';
						$tail = str_replace(DS, '/', substr($fileName, strlen($head)));
						$interestStream->icon = '{{baseUrl}}/Q/uploads' . $tail;
					} else {
						$result = Users::importIcon($interestStream, array(
							'32.png' => $iconSmall
						), $interestStream->iconDirectory());
					}
				} catch (Exception $e) {

				}
			}

			if (empty($result) && $streamIcon) {
				$interestStream->icon = $streamIcon;
				$interestStream->setAttribute('iconSize', 40);
			} else {
				$interestStream->setAttribute('iconSize', 32);
			}

			$interestStream->save();
		}

		$streamName = $streamType."/".self::normalizeUrl($url);

		$td = trim($description);
		$streamParams = array(
            'name' => $streamName,
            'title' => trim($title),
			'icon' => $streamIcon,
            'content' => $td ? $td : "",
            'attributes' => array(
                'url' => $url,
                'urlParsed' => $urlParsed,
                'host' => $host,
                'port' => $port,
                'copyright' => $copyright,
                'contentType' => $contentType,
				'interest' => array(
					'publisherId' => $interestStream->publisherId,
					'streamName' => $interestStream->name
				),
                'lang' => Q::ifset($siteData, 'lang', 'en')
            ),
            'skipAccess' => $skipAccess
        );
		$relatedParams = array(
            'publisherId' => $interestPublisherId,
            'streamName' => $interestStreamName,
            'type' => $streamType.'/interest'
        );

		if ($streamType == 'Websites/webpage') {
            $webpageStream = Streams::create($asUserId, $publisherId, $streamType, $streamParams, $relatedParams);
		} else {
            $streamParams['publisherId'] = $publisherId;
            $streamParams['streamName'] = $streamName;

            $webpageStream = Q::event($streamType.'/post', array(
                'streamParams' => $streamParams,
                'relatedParams' => $relatedParams
            ));
        }

		// try to import icon from $iconBig
		Streams::importIcon($webpageStream->publisherId, $webpageStream->name, $iconBig, "Websites/image");

		// grant access to this stream for logged user
		$streamsAccess = new Streams_Access();
		$streamsAccess->publisherId = $webpageStream->publisherId;
		$streamsAccess->streamName = $webpageStream->name;
		$streamsAccess->ofUserId = $asUserId;
		$streamsAccess->readLevel = Streams::$READ_LEVEL['max'];
		$streamsAccess->writeLevel = Streams::$WRITE_LEVEL['max'];
		$streamsAccess->adminLevel = Streams::$ADMIN_LEVEL['max'];
		$streamsAccess->save();

		// if publisher not community, subscribe publisher to this stream
		if (!Users::isCommunityId($publisherId)) {
			$webpageStream->subscribe(array('userId' => $publisherId));
		}

		// handle with keywords
		if (!empty($keywords)) {
			$delimiter = preg_match("/,/", $keywords) ? ',' : ' ';
			foreach (explode($delimiter, $keywords) as $keyword) {
				$keywordInterestStream = Streams::getInterest(trim($keyword));
				if ($keywordInterestStream instanceof Streams_Stream) {
					$webpageStream->relateTo($keywordInterestStream, $webpageStream->type.'/keyword', $webpageStream->publisherId, array(
						'skipAccess' => true
					));
				}
			}
		}

		// set quota
		if (!$skipAccess && $quota instanceof Users_Quota) {
			$quota->used();
		}

		return $webpageStream;
	}
	/**
	 * Get stream interests in one array with items having properties
	 *  {publisherId, streamName, title}
	 * @method getInterests
	 * @static
	 * @param Streams_Stream $stream Websites/webpage stream
	 * @return array
	 */
	static function getInterests($stream)
	{
		$rows = Streams_Stream::select('ss.publisherId, ss.name as streamName, ss.title', 'ss')
			->join(Streams_relatedTo::table(true, 'srt'), array(
				'srt.toStreamName' => 'ss.name',
				'srt.toPublisherId' => 'ss.publisherId'
			))->where(array(
				//'srt.fromPublisherId' => $stream->publisherId,
				'srt.fromStreamName' => $stream->name,
				'srt.type' => $stream->type.'/interest'
			))
			->orderBy('srt.weight', false)
			->fetchDbRows();

		return reset($rows);
	}
	/**
	 * Get stream interests in one array with items having properties
	 *  {publisherId, streamName, title}
	 * @method getKeywords
	 * @static
	 * @param Streams_Stream $stream Websites/webpage stream
	 * @return array
	 */
	static function getKeywords($stream)
	{
		$rows = Streams_Stream::select('ss.publisherId, ss.name, ss.title', 'ss')
			->join(Streams_relatedTo::table(true, 'srt'), array(
				'srt.toStreamName' => 'ss.name',
				'srt.toPublisherId' => 'ss.publisherId'
			))->where(array(
				'srt.fromPublisherId' => $stream->publisherId,
				'srt.fromStreamName' => $stream->name,
				'srt.type' => $stream->type.'/keyword'
			))
			->orderBy('srt.weight', false)
			->fetchDbRows();

		return $rows;
	}

	/**
	 * Load a URL in headless Chrome, inject analyze.js and cssprobe.js,
	 * and return computed styles, fonts, dominant colors, and nav heuristics.
	 * Also crawls CSS (server-side) to follow @import and collect @font-face blocks.
	 *
	 * @method analyze
	 * @static
	 * @param {string} $url The webpage URL to analyze.
	 * @return {array} Analysis result object with the following keys:
	 *
	 *   {
	 *     title: {string}          The page title.
	 *     url: {string}            Final navigated URL (after redirects).
	 *
	 *     stylesBySelector: {object}   Map of sample selectors (e.g. "h1", "p") to computed style subsets.
	 *     fonts: {array<string>}       List of font-family strings observed on page elements.
	 *     dominantColors: {array<object>}  List of {hex, count} for common colors seen (text/bg/borders).
	 *     rootThemeColors: {object}    Map of CSS variable name → resolved hex color (from :root).
	 *
	 *     navCandidates: {array<object>}  Candidate nav elements scored by heuristics.
	 *         Each candidate: {
	 *           selector: {string}   CSS path to element.
	 *           score: {number}      Heuristic score.
	 *           rect: {object}       {top, left, width, height} bounding box.
	 *           links: {array<object>}  Array of {text, href}.
	 *         }
	 *     detectedNav: {object|null} The best nav candidate, same shape as above.
	 *
	 *     colorRoles: {object} {
	 *       foreground: {array<object>}   Top foreground text colors {hex, count}.
	 *       background: {array<object>}   Top background colors {hex, count}.
	 *     }
	 *
	 *     _assets: {object} {
	 *       cssUrls: {array<string>}      Stylesheet hrefs discovered.
	 *       fetchedCss: {object}          Map of cssUrl → byte length fetched server-side.
	 *       fontFaces: {array<object>}    Parsed @font-face blocks:
	 *           { family: {string}, style: {string}, weight: {string}, src: {array<string>} }
	 *       fontFiles: {array<string>}    Absolute or data: URLs of font files.
	 *     }
	 *
	 *     largestBlocks: {array<object>}  Largest visual blocks scanned with {selector, rect, color, backgroundColor}.
	 *
	 *     _analyzer: {object} {
	 *       path: {string}   Path to analyze.js used.
	 *       ts: {number}     Unix timestamp when run.
	 *     }
	 *   }
	 *
	 * @throws Exception If Chrome is not reachable or scripts not found.
	 */
	public static function analyze($url)
	{
		// Normalize URL
		$parts = explode('#', $url);
		$url = reset($parts);
		if (parse_url($url, PHP_URL_SCHEME) === null) {
			$url = 'http://' . $url;
		}
		if (!Q_Valid::url($url)) {
			throw new Exception("Invalid URL");
		}

		// Locate JS analyzers
		if (!defined('WEBSITES_PLUGIN_WEB_DIR')) {
			throw new Exception('WEBSITES_PLUGIN_WEB_DIR is not defined');
		}
		$analyzerPath = WEBSITES_PLUGIN_WEB_DIR . DS . 'js' . DS . 'analyze.js';
		$cssProbePath = WEBSITES_PLUGIN_WEB_DIR . DS . 'js' . DS . 'cssprobe.js';

		foreach (array($analyzerPath, $cssProbePath) as $path) {
			if (!is_file($path)) {
				throw new Exception("Analyzer script not found at: " . $path);
			}
		}

		$analyzerJs = file_get_contents($analyzerPath);
		$cssProbeJs = file_get_contents($cssProbePath);
		if ($analyzerJs === false || $analyzerJs === '' || $cssProbeJs === false || $cssProbeJs === '') {
			throw new Exception("Failed to read analyzer scripts");
		}

		// Connect to Chrome
		$browser = self::_chromeConnect();

		try {
			$page = $browser->createPage();
			$page->navigate($url)->waitForNavigation();

			// Run analyze.js
			$wrapped = '(function(){' . $analyzerJs . '})()';
			$evaluation = $page->evaluate($wrapped);
			$evaluation->waitForResponse(20000);
			$result = $evaluation->getReturnValue();

			if (!is_array($result)) {
				$evaluation = $page->evaluate('window.__WebsitesAnalyze ? window.__WebsitesAnalyze() : null;');
				$evaluation->waitForResponse(20000);
				$result = $evaluation->getReturnValue();
			}
			if (!is_array($result)) {
				$out = array(
					'url'   => $url,
					'error' => 'Analyzer returned non-array result',
					'raw'   => $result
				);
				$browser->close();
				return $out;
			}

			// Run cssprobe.js (returns css hrefs + fg/bg tallies)
			$probeEval = $page->evaluate($cssProbeJs);
			$probeEval->waitForResponse(12000);
			$probeVal = $probeEval->getReturnValue();

			$sheetUrls = (is_array($probeVal) && isset($probeVal['css']) && is_array($probeVal['css']))
				? $probeVal['css'] : array();
			$colorRoles = (is_array($probeVal) && isset($probeVal['colors']) && is_array($probeVal['colors']))
				? $probeVal['colors'] : array('foreground'=>array(), 'background'=>array());

			// Server-side CSS crawl
			$seen    = array(); // set of css urls
			$fetched = array(); // cssUrl => length
			$faces   = array(); // list of parsed @font-face blocks
			$fontSet = array(); // set of font file urls

			for ($i=0; $i<count($sheetUrls); $i++) {
				$cssUrl = $sheetUrls[$i];
				self::_crawlCss($cssUrl, $seen, $fetched, $faces, $fontSet);
			}

			// Pack up assets
			$fontList = array();
			foreach ($fontSet as $fu => $t) { $fontList[] = $fu; }

			$result['_assets'] = array(
				'cssUrls'    => $sheetUrls,
				'fetchedCss' => $fetched,
				'fontFaces'  => $faces,
				'fontFiles'  => $fontList
			);

			$result['colorRoles'] = array(
				'foreground' => isset($colorRoles['foreground']) ? $colorRoles['foreground'] : array(),
				'background' => isset($colorRoles['background']) ? $colorRoles['background'] : array()
			);

			$result['_analyzer'] = array(
				'path' => $analyzerPath,
				'cssProbe' => $cssProbePath,
				'ts' => time()
			);

			$browser->close();
			return $result;

		} catch (Exception $e) {
			if ($browser) { try { $browser->close(); } catch (Exception $e2) {} }
			throw $e;
		}
	}

	/**
	 * Private helper: connect to an already-running headless Chrome
	 * (e.g., Docker container bound to 127.0.0.1:9222).
	 *
	 * Reads CHROME_HOST/CHROME_PORT if present.
	 *
	 * @return \HeadlessChromium\Browser
	 * @throws Exception
	 */
	private static function _chromeConnect()
	{
		$host = getenv('CHROME_HOST') ? getenv('CHROME_HOST') : '127.0.0.1';
		$port = getenv('CHROME_PORT') ? (int)getenv('CHROME_PORT') : 9222;
		$versionUrl = 'http://' . $host . ':' . $port . '/json/version';

		// Fetch via curl if available, else file_get_contents
		$metaJson = null;
		if (function_exists('curl_init')) {
			$ch = curl_init($versionUrl);
			curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
			curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
			curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 3);
			curl_setopt($ch, CURLOPT_TIMEOUT, 5);
			$metaJson = curl_exec($ch);
			curl_close($ch);
		} else {
			$ctx = stream_context_create(array('http' => array('timeout' => 5)));
			$metaJson = @file_get_contents($versionUrl, false, $ctx);
		}

		if (!$metaJson) {
			throw new Exception('Cannot reach Chrome DevTools at ' . $versionUrl);
		}

		$meta = json_decode($metaJson, true);
		if (!is_array($meta) || !isset($meta['webSocketDebuggerUrl'])) {
			throw new Exception('webSocketDebuggerUrl not found at ' . $versionUrl);
		}

		if (!class_exists('HeadlessChromium\\BrowserFactory')) {
			throw new Exception("HeadlessChromium library not installed. Run composer require chrome-php/chrome.");
		}

		// Connect without spawning a local Chrome
		return BrowserFactory::connectToBrowser($meta['webSocketDebuggerUrl'], array(
			'sendSyncDefaultTimeout' => 20000 // ms
			// 'debugLogger' => 'php://stdout',
		));
	}

	// Resolve a possibly-relative URL against a base URL (handles protocol-relative, root, ../)
	private static function _absUrl($base, $rel)
	{
		if (!$rel) return $rel;
		$p = parse_url($base);
		if (preg_match('#^https?:#i', $rel)) return $rel;
		if (strpos($rel, '//') === 0) return $p['scheme'].':'.$rel;

		$host = $p['scheme'].'://'.$p['host'].(isset($p['port']) ? ':'.$p['port'] : '');
		if ($rel[0] === '/') return $host.$rel;

		$path = isset($p['path']) ? $p['path'] : '/';
		$dir  = $host . rtrim(dirname($path), '/').'/';
		$full = $dir.$rel;

		$parts = explode('/', $full);
		$out = array();
		$i = 0; for ($i=0; $i<count($parts); $i++) {
			$seg = $parts[$i];
			if ($seg === '' || $seg === '.') continue;
			if ($seg === '..') { if (!empty($out)) array_pop($out); continue; }
			$out[] = $seg;
		}
		return '/'.implode('/', $out);
	}

	// Fetch a URL body (curl preferred; falls back to file_get_contents), permissive SSL.
	private static function _fetch($url, $timeout)
	{
		if (function_exists('curl_init')) {
			$ch = curl_init($url);
			curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
			curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
			curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, $timeout);
			curl_setopt($ch, CURLOPT_TIMEOUT, $timeout);
			curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
			curl_setopt($ch, CURLOPT_SSL_VERIFYHOST, false);
			$body = curl_exec($ch);
			curl_close($ch);
			return $body;
		}
		$ctx = stream_context_create(array('http' => array('timeout' => $timeout)));
		return @file_get_contents($url, false, $ctx);
	}

	/**
	 * Recursively crawl CSS starting from $cssUrl:
	 *  - follow @import
	 *  - collect @font-face blocks (family, weight, style, src[] urls)
	 *  - collect every font file url (absolute or data:)
	 *
	 * @param string $cssUrl
	 * @param array  &$seen     set of visited css urls
	 * @param array  &$fetched  map cssUrl => byte length
	 * @param array  &$faces    list of parsed font-face blocks
	 * @param array  &$fontSet  set of font file urls (url => true)
	 */
	private static function _crawlCss($cssUrl, &$seen, &$fetched, &$faces, &$fontSet)
	{
		if (isset($seen[$cssUrl])) return;
		$seen[$cssUrl] = true;

		$css = self::_fetch($cssUrl, 12);
		if (!is_string($css) || $css === '') return;

		$fetched[$cssUrl] = strlen($css);

		// 1) Follow @import (url(...) or "...")
		if (preg_match_all('#@import\s+(?:url\(\s*([^\)]+)\s*\)|([\'"])(.*?)\2)\s*[^;]*;#i', $css, $imports, PREG_SET_ORDER)) {
			$i = 0; for ($i=0; $i<count($imports); $i++) {
				$raw = isset($imports[$i][1]) && $imports[$i][1] ? $imports[$i][1] : $imports[$i][3];
				$raw = trim($raw, " \t\n\r\0\x0B\"'");
				$child = self::_absUrl($cssUrl, $raw);
				self::_crawlCss($child, $seen, $fetched, $faces, $fontSet);
			}
		}

		// 2) Parse @font-face blocks
		if (preg_match_all('#@font-face\s*\{(.*?)\}#is', $css, $blocks, PREG_SET_ORDER)) {
			$j = 0; for ($j=0; $j<count($blocks); $j++) {
				$block = $blocks[$j][1];

				// Extract descriptors
				$family = null; $style = null; $weight = null; $srcRaw = null;

				if (preg_match('#font-family\s*:\s*([^;]+);#i', $block, $m)) {
					$family = trim($m[1]);
					$family = trim($family, "\"' \t\r\n");
				}
				if (preg_match('#font-style\s*:\s*([^;]+);#i', $block, $m)) {
					$style = trim($m[1]);
				}
				if (preg_match('#font-weight\s*:\s*([^;]+);#i', $block, $m)) {
					$weight = trim($m[1]);
				}
				if (preg_match('#src\s*:\s*([^;]+);#is', $block, $m)) {
					$srcRaw = $m[1];
				}

				// Extract all url(...) inside src (or whole block, to catch multiple src locations)
				$urlsBlock = $srcRaw ? $srcRaw : $block;
				$srcs = array();
				if (preg_match_all('#url\(\s*([^\)]+)\s*\)#i', $urlsBlock, $uMatches)) {
					$k = 0; for ($k=0; $k<count($uMatches[1]); $k++) {
						$u = trim($uMatches[1][$k], " \t\n\r\0\x0B\"'");
						if (stripos($u, 'data:') === 0) {
							// data: URI — keep as is
							$srcs[] = $u;
							$fontSet[$u] = true;
						} else {
							// resolve relative to current CSS file
							$abs = self::_absUrl($cssUrl, $u);
							$srcs[] = $abs;
							$fontSet[$abs] = true;
						}
					}
				}

				$faces[] = array(
					'family' => $family,
					'style'  => $style,
					'weight' => $weight,
					'src'    => $srcs
				);
			}
		}
	}

	/**
	 * Generate a variable-only CSS file from the analyze() payload.
	 *
	 * PHP 5.3 compatible.
	 *
	 * @param array $analysis Output of Websites_Webpage::analyze($url)
	 * @param array $options  {
	 *   scope: string  CSS scope selector (default ':root'; often '[data-theme="imported"]')
	 *   includeFonts: bool Include @font-face blocks (default true)
	 *   maxFonts: int Limit number of font families emitted (default 6)
	 *   baseFontFamily: string Fallback stack (default system-ui...)
	 *   preferAnalysisFonts: bool If true, prefer first discovered font (default true)
	 * }
	 * @return string CSS text containing only variables (+ optional font-face)
	 */
	public static function generateThemeCss($analysis, $options = array())
	{
		$scope               = isset($options['scope']) ? $options['scope'] : ':root';
		$includeFonts        = array_key_exists('includeFonts', $options) ? (bool)$options['includeFonts'] : true;
		$maxFonts            = isset($options['maxFonts']) ? (int)$options['maxFonts'] : 6;
		$baseFontFamily      = isset($options['baseFontFamily']) ? $options['baseFontFamily']
								: 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
		$preferAnalysisFonts = array_key_exists('preferAnalysisFonts', $options) ? (bool)$options['preferAnalysisFonts'] : true;

		$get = function ($arr /*, k1, k2... */) {
			$args = func_get_args();
			array_shift($args);
			foreach ($args as $k) {
				if (!is_array($arr) || !array_key_exists($k, $arr)) return null;
				$arr = $arr[$k];
			}
			return $arr;
		};

		$q = function ($s) {
			$s = trim($s);
			if ($s === '') return $s;
			if (preg_match('/^[a-zA-Z0-9\-]+$/', $s)) return $s;
			return '"' . str_replace('"', '\\"', $s) . '"';
		};

		$firstHex = function ($arr) {
			if (!is_array($arr)) return null;
			foreach ($arr as $e) {
				if (is_array($e) && isset($e['hex'])) return strtolower($e['hex']);
				if (is_string($e) && preg_match('/^#([0-9a-f]{6})$/i', $e)) return strtolower($e);
			}
			return null;
		};

		// ---------- Extract palette ----------
		$fgTop = $firstHex($get($analysis, 'colorRoles', 'foreground'));
		$bgTop = $firstHex($get($analysis, 'colorRoles', 'background'));
		$dom   = $get($analysis, 'dominantColors');

		if (!$fgTop && isset($dom[0]['hex'])) $fgTop = $dom[0]['hex'];
		if (!$bgTop && isset($dom[1]['hex'])) $bgTop = $dom[1]['hex'];
		if (!$fgTop) $fgTop = '#222222';
		if (!$bgTop) $bgTop = '#ffffff';

		$fgList = $get($analysis, 'colorRoles', 'foreground');
		$acc1 = isset($fgList[1]['hex']) ? $fgList[1]['hex'] : '#4a90e2';
		$acc2 = isset($fgList[2]['hex']) ? $fgList[2]['hex'] : '#e67e22';

		$nav = $get($analysis, 'detectedNav');
		$navFg = is_array($nav) && isset($nav['color']) ? $nav['color'] : $fgTop;
		$navBg = is_array($nav) && isset($nav['backgroundColor']) ? $nav['backgroundColor'] : $bgTop;

		// ---------- Fonts ----------
		$fonts = $get($analysis, 'fonts');
		$bodyFamily = $baseFontFamily;
		if ($preferAnalysisFonts && is_array($fonts) && count($fonts)) {
			$raw = $fonts[0];
			$primary = trim(strtok($raw, ','));
			if ($primary) $bodyFamily = $q($primary) . ', ' . $baseFontFamily;
		}

		// ---------- Variable block ----------
		$vars  = "/* Theme variables generated from analysis */\n";
		$vars .= $scope . " {\n";
		$vars .= "  --theme-fg: {$fgTop};\n";
		$vars .= "  --theme-bg: {$bgTop};\n";
		$vars .= "  --theme-accent-1: {$acc1};\n";
		$vars .= "  --theme-accent-2: {$acc2};\n";
		$vars .= "  --theme-nav-bg: {$navBg};\n";
		$vars .= "  --theme-nav-fg: {$navFg};\n";
		$vars .= "  --theme-font: {$bodyFamily};\n";
		$vars .= "}\n\n";

		// ---------- Optional fonts ----------
		$fontBlocks = array();
		if ($includeFonts) {
			$faces = $get($analysis, '_assets', 'fontFaces');
			if (is_array($faces)) {
				$c = 0;
				foreach ($faces as $face) {
					if ($c++ >= $maxFonts) break;
					$fam = $q((string)$get($face, 'family'));
					if (!$fam) continue;
					$style  = $get($face, 'style') ? $get($face, 'style') : 'normal';
					$weight = $get($face, 'weight') ? $get($face, 'weight') : '400';
					$srcs = $get($face, 'src');
					$urls = array();
					if (is_array($srcs)) {
						foreach ($srcs as $u) {
							if (!is_string($u) || !$u) continue;
							$urls[] = "url('".$u."')";
						}
					}
					if (count($urls)) {
						$fontBlocks[] =
	"@font-face {
	font-family: {$fam};
	font-style: {$style};
	font-weight: {$weight};
	src: " . implode(",\n       ", $urls) . ";
	}";
					}
				}
			}
		}
		if (count($fontBlocks)) $vars .= implode("\n\n", $fontBlocks) . "\n";

		return $vars;
	}
}
