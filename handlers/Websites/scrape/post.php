<?php
	
function Websites_scrape_post($params)
{
	// don't let just anyone call this, but only pages loaded from valid sessions
	Q_Valid::nonce(true);

    $params = array_merge($_REQUEST, $params);

	$fields = Q::take($params, array('url', 'skipStream'));

	$url = $fields['url'];
	$parts = explode('#', $url);
	$url = reset($parts);

	// stream required if publisherId and streamName slots requested
	$streamRequired = Q_Request::slotName("publisherId") && Q_Request::slotName("streamName");

	if (parse_url($url, PHP_URL_SCHEME) === null) {
		$url = 'https://'.$url;
	}

	// check youtube extended data
	if ($params['platform'] == 'youtube' && $params['videoId']) {
		$cached = Websites_Webpage::cacheGet($url);
		if (!$cached) {
			if (substr($url, -1) === '/') {
				$cached = Websites_Webpage::cacheGet(substr($url, 0, -1));
			} else {
				$cached = Websites_Webpage::cacheGet($url.'/');
			}
		}
		if ($cached) {
			if ($cached['extended']) {
				$result = $cached;
			} else {
				$youtubeData = Websites_Webpage::youtube(array(
					"query" => array("part" => "contentDetails"),
					"videoId" => $params['videoId'],
					"pureResult" => true
				));
				$duration = Q::ifset($youtubeData, "items", 0, "contentDetails", "duration", null);
				if ($duration) {
					$h = $m = $s = array(0);
					preg_match("/\d{1,2}h/i", $duration, $h);
					preg_match("/\d{1,2}m/i", $duration, $m);
					preg_match("/\d{1,2}s/i", $duration, $s);
					$duration = (int)reset($h) * 3600 + (int)reset($m) * 60 + (int)reset($s);
				}
				$result = array_merge($cached, compact("duration"));
				$result['extended'] = true;
				Websites_Webpage::cacheSet($url, $result);
			}
		} else {
			$result = Websites_Webpage::scrape($url);
		}
	} else {
		$result = Websites_Webpage::scrape($url);
	}

	// check if stream already exists
	$stream = Websites_Webpage::fetchStream($url);

	if ($streamRequired && !$stream) {
		$stream = Websites_Webpage::createStream(@compact("url"));
	}

	Q_Response::setSlot('publisherId', Q::ifset($stream, "publisherId", null));
	Q_Response::setSlot('streamName', Q::ifset($stream, "name", null));

	$result["alreadyExist"] = (bool)$stream;

	Q_Response::setSlot('result', $result);
}