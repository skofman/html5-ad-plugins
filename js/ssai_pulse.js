/*
 * Ad Manager for SSAI Pulse
 *
 * version 0.1
 */

require("../html5-common/js/utils/InitModules/InitOO.js");
require("../html5-common/js/utils/InitModules/InitOOJQuery.js");
require("../html5-common/js/utils/InitModules/InitOOUnderscore.js");
require("../html5-common/js/utils/InitModules/InitOOHazmat.js");
require("../html5-common/js/utils/InitModules/InitOOPlayerParamsDefault.js");

require("../html5-common/js/utils/constants.js");
require("../html5-common/js/utils/utils.js");
require("../html5-common/js/utils/environment.js");

require("../utils/VastParser.js");

OO.Ads.manager(function(_, $) {
  /**
   * @class SsaiPulse
   * @classDesc The SSAI Pulse Ads Manager class, registered as an ads manager with the ad manager controller.
   * Controls how SSAI Pulse ads are loaded and played while communicating with the ad manager framework.
   * @public
   * @property {string} name The name of the ad manager. This should match the name used by the server to
   *                         provide metadata.
   * @property {boolean} ready Should be set to false initially.  Should be set to true when the ad manager
   *                           has loaded all external files and metadata to notify the controller that the
   *                           ad manager is ready for the user to hit play.
   * @property {object} videoRestrictions Optional property that represents restrictions on the video plugin
   *   used.  ex. {"technology":OO.VIDEO.TECHNOLOGY.HTML5, "features":[OO.VIDEO.FEATURE.VIDEO_OBJECT_TAKE]}
   */
  var SsaiPulse = function() {
    this.name = "ssai-pulse-ads-manager";
    this.ready = false;
    this.videoRestrictions = {};
    this.testMode = false;

    this.currentId3Object = null;
    this.currentAd = null;

    var amc  = null;

    // Tracking Event states
    var adMode = false;
    var isFullscreen = false;
    var isMuted = false;
    var lastVolume = -1;

    // Params required for ads proxy ads request
    // Request URL will already have initial query parameters; none of these query parameters
    // will be the first (will not need a prefixed "?").
    var SMART_PLAYER = "&oosm=1";
    var OFFSET_PARAM = "&offset=";
    var OFFSET_VALUE = "5"; // seconds
    var AD_ID_PARAM = "&aid=";

    var baseRequestUrl = "";
    var requestUrl = "";

    var adIdDictionary = {};

    // The expected query parameters in an ID3 Metadata String
    var ID3_QUERY_PARAMETERS = {
      // The ID of the ad, will correspond to an ad id found in the Vast Ad Response XML
      AD_ID: "adid",

      // At the moment this value does not mean anything. PRD states this parameter should actually
      // be the ad progress percentage. Live team the progress percentage will be added for Q3.
      TIME: "t",

      // Duration of the ad
      DURATION: "d"
    };

    // variable to store the timeout used to keep track of how long an SSAI ad plays
    var adDurationTimeout;

    /**
     * Called by the Ad Manager Controller.  Use this function to initialize, create listeners, and load
     * remote JS files.
     * @method SsaiPulse#initialize
     * @public
     * @param {object} adManagerController A reference to the Ad Manager Controller
     * @param {string} playerId The unique player identifier of the player initializing the class
     */
    this.initialize = function(adManagerController, playerId) {
      amc = adManagerController;

      // Add any player event listeners now
      amc.addPlayerListener(amc.EVENTS.CONTENT_CHANGED, _.bind(_onContentChanged, this));

      // ID3 Tag
      amc.addPlayerListener(amc.EVENTS.VIDEO_TAG_FOUND, _.bind(this.onVideoTagFound, this));
      // Stream URL
      amc.addPlayerListener(amc.EVENTS.CONTENT_URL_CHANGED, _.bind(this.onContentUrlChanged, this));

      // Listeners for tracking events
      amc.addPlayerListener(amc.EVENTS.FULLSCREEN_CHANGED, _.bind(this.onFullscreenChanged, this));
      amc.addPlayerListener(amc.EVENTS.AD_VOLUME_CHANGED, _.bind(this.onAdVolumeChanged, this));
    };

    /**
     * Called by Ad Manager Controller.  When this function is called, the ui has been setup and the values
     * in amc.ui are ready to be used.
     * @method SsaiPulse#registerUi
     * @public
     */
    this.registerUi = function() {
      // amc.ui.adVideoElement is now ready for use
    };

    /**
     * Called by Ad Manager Controller.  When this function is called, all movie and server metadata are
     * ready to be parsed.
     * This metadata may contain the adTagUrl and other ad manager and movie specific configuration.
     * @method SsaiPulse#loadMetadata
     * @public
     * @param {object} adManagerMetadata Ad manager-specific metadata
     * @param {object} backlotBaseMetadata Base metadata from Ooyala Backlot
     * @param {object} movieMetadata Metadata for the main video
     */
    this.loadMetadata = function(adManagerMetadata, backlotBaseMetadata, movieMetadata) {
      this.ready = true;
    };

    /**
     * Called once per video by Ad Manager Controller once the ad manager has set its ready flag to true.
     * This function asks the ad manager to return a list of all ads to the controller for addition in the
     * timeline.  If the list of ads is not available at this time, return [] or null and call
     * [SsaiPulseController].appendToTimeline() when the ads become available.
     * The duration and position of each ad should be specified in seconds.
     * @method SsaiPulse#buildTimeline
     * @public
     * @returns {OO.SsaiPulseController#Ad[]} timeline A list of the ads to play for the current video
     */
    this.buildTimeline = function() {
      //Video restrictions can be provided at the ad level. If provided, the player will
      //attempt to create a video element that supports the given video restrictions.
      //If created, it will exist in amc.ui.adVideoElement by the time playAd is called.
      //If the element is not created due to lack of support from the available video plugins,
      //the ad will be skipped
      return null;
    };

    /**
     * Called by Ad Manager Controller.  The ad manager should play the ad or group of podded ads passed to
     * the function as a parameter.
     * @method SsaiPulse#playAd
     * @public
     * @param {object} ad The ad object to play
     * @param {function} adPodStartedCallback Call this function when the ad or group of podded ads have
     *                                        started
     * @param {function} adPodEndedCallback Call this function when the ad or group of podded ads have
     *                                      completed
     * @param {function} adStartedCallback Call this function each time an ad in the set starts
     * @param {function} adEndedCallback Call this function each time an ad in the set completes
     */
    this.playAd = function(ad, adPodStartedCallback, adPodEndedCallback, adStartedCallback, adEndedCallback) {
      if (ad) {
        adMode = true;
        this.currentAd = ad;
        if (ad.ad) {
          amc.notifyLinearAdStarted(ad.id, {
            name: ad.ad.name,
            hasClickUrl: true,
            duration: ad.duration,
            ssai: ad.ad.ssai,
            isLive: ad.ad.isLive
          });
        }
      }
    };

    /**
     * Called by Ad Manager Controller.  The ad manager should cancel the ad passed to the function as a
     * parameter.  After cancelling the ad, the ad manager should call the adEndedCallback to indicate that
     * ad cancellation has completed.  If the given ad is not currently playing and the adEndedCallback has
     * already been called, then no action is required.
     * @method SsaiPulse#cancelAd
     * @public
     * @param {object} ad The ad object to cancel
     * @param {object} params An object containing information about the cancellation. It will include the
     *                        following fields:
     *                 code : The amc.AD_CANCEL_CODE for the cancellation
     */
    this.cancelAd = function(ad, params) {
    };

    /**
     * Called by Ad Manager Controller.  The ad manager should pause the ad passed to the function as a
     * parameter.  If the given ad is not currently playing, no action is required.
     * @method SsaiPulse#pauseAd
     * @public
     * @param {object} ad The ad object to pause
     */
    this.pauseAd = function(ad) {
    };

    /**
     * Called by Ad Manager Controller.  The ad manager should resume the ad passed to the function as a
     * parameter.  If the given ad is not currently loaded or not paused, no action is required.
     * @method SsaiPulse#resumeAd
     * @public
     * @param {object} ad The ad object to resume
     */
    this.resumeAd = function(ad) {
    };

    /**
     * <i>Optional.</i><br/>
     * When the Ad Manager Controller needs to hide the overlay it will call this function.
     * NOTE: This function should only be used by the ad manager if the cancelOverlay function is not being used.
     * NOTE 2: Only implement this function if you plan to hide and reshow the overlay. Otherwise delete it or leave it commented.
     * @method SsaiPulse#hideOverlay
     * @public
     * @param {object} currentAd The overlay ad object to be stored so when it is shown again, we can update the AMC
     */
    //this.hideOverlay = function(currentAd) {
    //};

    /**
     * <i>Optional.</i><br/>
     * When the Ad Manager Controller needs to cancel the overlay it will call this function.
     * NOTE: This function should only be used by the ad manager if the hideOverlay function is not being used.
     * NOTE 2: Only implement this function if you plan to cancel and not reshow the overlay. Otherwise leave it commented or delete it.
     * @method SsaiPulse#cancelOverlay
     * @public
     * @param {object} currentAd The overlay ad object that the ad manager needs to know is going to be cancelled and removed
     */
    //this.cancelOverlay = function(currentAd) {
    //};

    /**
     * This function gets called by the ad Manager Controller when an ad has completed playing. If the main video is
     * finished playing and there was an overlay displayed before the post-roll then it needs to be removed. If the main
     * video hasn't finished playing and there was an overlay displayed before the ad video played, then it will show
     * the overlay again.
     * @method SsaiPulse#showOverlay
     * @public
     */
    this.showOverlay = function() {
    };

    /**
     * <i>Optional.</i><br/>
     * Called when player clicks on the tap frame, if tap frame is disabled, then this function will not be
     * called
     * @method SsaiPulse#playerClicked
     * @public
    */
    this.playerClicked = function(amcAd, showPage) {
      if (amcAd && amcAd.ad) {
        window.open(amcAd.ad.clickthrough);
      }
    };

    /**
     * <i>Optional.</i><br/>
     * Called when the player detects start of ad video playback.
     * @method SsaiPulse#adVideoPlaying
     * @public
     */
    this.adVideoPlaying = function() {
    };

    /**
     * Called when the player creates a new video element and selects the stream url.
     * @public
     * @method SsaiPulse#onContentUrlChanged
     * @param {string} url The stream url
     */
    this.onContentUrlChanged = function(eventName, url) {
      //baseRequestUrl = _makeSmartUrl(url);
      baseRequestUrl = url;
      amc.updateMainStreamUrl(url);
      baseRequestUrl = _preformatUrl(baseRequestUrl);
    };

    /**
     * This is an example callback that interprets video stream tags.  The event is subscribed to in
     * the initialize function.
     * @public
     * @method SsaiPulse#onVideoTagFound
     * @param {string} event The event that triggered this callback
     * @param {string} videoId The id of the video element that processed a tag
     * @param {string} tagType The type of tag that was detected
     * @param {object} metadata Any metadata attached to the found tag
     */
    this.onVideoTagFound = function(eventName, videoId, tagType, metadata) {
      OO.log("TAG FOUND w/ args: ", arguments);
      this.currentId3Object = _parseId3Object(metadata);
      if (this.currentId3Object) {
        requestUrl = baseRequestUrl;
        requestUrl = _appendAdsProxyQueryParameters(requestUrl, this.currentId3Object.adId);

        // Check to see if we already have adId in dictionary
        if (!_.has(adIdDictionary, this.currentId3Object.adId)) {
          adIdDictionary[this.currentId3Object.adId] = true;

          // Clear any previous timeouts and notify end of ad.
          if (this.currentAd) {
            _adEndedCallback();
          }

          _handleId3Ad(this.currentId3Object);
        }
        /*
         *else if (!this.currentAd || // Check if there is a current ad, if there isn't, replay the ad that was cached.
         *         (this.currentAd && this.currentAd.id3AdId !== this.currentAd3Object.adId)) { // Check if the ad already playing is not itself
         *  _handleId3Ad(this.currentId3Object);
         *}
         */
      }
    };

    /**
     * Helper function to handle the ID3 Ad timeout and request.
     * @private
     * @method SsaiPulse#_handleId3Ad
     * @param {object} id3Object The ID3 object
     */
    var _handleId3Ad = _.bind(function(id3Object) {
      // Will call _sendRequest() once live team fixes ads proxy issue. Will directly call onResponse() for now.
      this.onResponse(null, id3Object);
      if (!this.testMode) {
        // Set timer for duration of the ad.
        adDurationTimeout = _.delay(_adEndedCallback, id3Object.duration * 1000);

        //_sendRequest(requestUrl);
      }
      // Remove this if calling _sendRequest()
    }, this);

    /**
     * Called if the ajax call succeeds
     * @public
     * @method SsaiPulse#onResponse
     * @param {XMLDocument} xml The xml returned from loading the ad
     * @param {object} id3Object The ID3 object
     */
    this.onResponse = function(xml, id3Object) {
      OO.log("SSAI Pulse: Response");
      // Call VastParser code
      // var vastAds = OO.VastParser.parser(xml);
      _forceMockAd(id3Object);
    };

    /**
     * Called if the ajax call fails
     * @public
     * @method SsaiPulse#onRequestError
     */
    this.onRequestError = function() {
      OO.log("SSAI Pulse: Error");
    };

    /**
     * Callback for Ad Manager Controller. Handles going into and out of fullscreen mode.
     * This is only required for VPAID ads
     * @public
     * @method Vast#onFullScreenChanged
     * @param {string} eventName The name of the event for which this callback is called
     * @param {boolean} isFullscreen True if entering fullscreen mode and false when exiting
     */
    this.onFullscreenChanged = function(eventName, isFullscreen) {
      // only try to ping tracking urls if player is playing an ad
      if (adMode) {
        if (isFullscreen) {
          // TODO: Hook up with new Vast parser util
          //_handleTrackingUrls(currentAd, ["fullscreen"]);
        }
        else if (!isFullscreen) {
          // TODO: Hook up with new Vast parser util
          //_handleTrackingUrls(currentAd, ["exitFullscreen"]);
        }
      }
    };

    /**
     * Callback for Ad Manager Controller. Handles volume changes.
     * @public
     * @method Vast#onAdVolumeChanged
     * @param {string} eventName The name of the event for which this callback is called
     * @param {number} volume The current volume level
     */
    this.onAdVolumeChanged = function(eventName, volume) {
      if (adMode) {
        if (volume === 0 && volume !== lastVolume) {
          isMuted = true;
          lastVolume = volume;
          // TODO: Hook up with new Vast parser util
          //_handleTrackingUrls(currentAd, ["mute"]);
        }
        else if (isMuted && volume !== lastVolume) {
          isMuted = false;
          lastVolume = volume;
          // TODO: Hook up with new Vast parser util
          //_handleTrackingUrls(currentAd, ["unmute"]);
        }
      }
    };

    /**
     * <i>Optional.</i><br/>
     * Called when the player detects an error in the ad video playback.  If the ad manager did not detect
     * this error itself, it can use this time to end the ad playback.
     * @method SsaiPulse#adVideoError
     * @public
     * @param {object} adWrapper The current Ad's metadata
     * @param {number} errorCode The error code associated with the video playback error
     */
    this.adVideoError = function(adWrapper, errorCode) {
    };

    /**
     * Called by Ad Manager Controller.  The ad manager should destroy itself.  It will be unregistered by
     * the Ad Manager Controller.
     * @method SsaiPulse#destroy
     * @public
     */
    this.destroy = function() {
      // Stop any running ads
      this.ready = false;
      this.currentAd = null;
      this.currentId3Object = null;
      adIdDictionary = {};
      _removeAMCListeners();
    };

    var _onContentChanged = function() {
      // Callback for example listener registered in this.initialize
    };

    // Helper Functions

    /**
     * Appends the smart player identifier to the request URL.
     * @private
     * @method SsaiPulse#_makeSmartUrl
     * @param {string} url The stream url
     * @returns {string} The modified stream url with the appended unique identifier.
     */
    var _makeSmartUrl = function(url) {
      return url + SMART_PLAYER;
    };

    /**
     * Helper function to append "offset" and "aid" query parameters to the request URL.
     * @private
     * @method SsaiPulse#_appendAdsProxyQueryParameters
     * @param {string} url The request URL
     * @param {string} adId The ID of the ad
     * @returns {string} The request URL with the appended query parameters.
     */
    var _appendAdsProxyQueryParameters = function(url, adId) {
      // vastUrl + '&offset=5&aid=' + adid
      return url + OFFSET_PARAM + OFFSET_VALUE + AD_ID_PARAM + adId;
    };

    /**
     * Helper function to replace change the HLS manifest URL to the endpoint used to retrieve
     * the Vast Ad Response from the ads proxy.
     * @private
     * @method SsaiPulse#_preformatUrl
     * @param {string} url The request URL
     * @returns {string} The request URL with the formatted request URL.
     */
    var _preformatUrl = function(url){
      //return ((url||'').indexOf('https') === -1 ? (url||'').replace('http:','https:') : url||'').replace('/hls/','/ai/');
      return (url ||'').replace('/hls/','/ai/');
    };

    /**
     * Attempts to load the Ad after normalizing the url.
     * @private
     * @method SsaiPulse#_sendRequest
     * @param {string} url The url that contains the Ad creative
     */
    var _sendRequest = _.bind(function(url) {
      $.ajax({
        url: url,
        type: 'GET',
        beforeSend: function(xhr) {
          xhr.withCredentials = true;
        },
        dataType: "xml",
        crossDomain: true,
        cache:false,
        success: _.bind(this.onResponse, this),
        error: _.bind(this.onRequestError, this)
      });
    }, this);

    /**
     * TODO: Improve return statement jsdoc
     * Parses the ID3 metadata that is received.
     * @private
     * @method SsaiPulse#_parseId3Object
     * @param {object} id3Object The ID3 metadata passed in
     * @returns {object} An object with "adId", "time", and "duration" as properties.
     */
    var _parseId3Object = _.bind(function(id3Object) {
      var parsedId3Object = null;
      if (id3Object) {
        if (_.has(id3Object, "TXXX")) {
          var id3String = id3Object.TXXX;
          parsedId3Object = _parseId3String(id3String);
        }
        else {
          OO.log("SSAI Pulse: Expected ID3 Metadata Object to have a 'TXXX' property");
        }
      }
      return parsedId3Object;
    }, this);

    /**
     * TODO: Improve return statement jsdoc
     * Parses the string contained in the ID3 metadata.
     * @private
     * @method SsaiPulse#_parseId3String
     * @param {string} id3String The string contained under the "TXXX" property to parse
     * @returns {object} An object with "adId", "time", and "duration" as properties.
     */
    var _parseId3String = _.bind(function(id3String) {
      var parsedId3Object = null;
      if (id3String) {
        parsedId3Object = {};
        var queryParameterStrings = id3String.split("&");
        if (queryParameterStrings.length === 3) {
          for (var i = 0; i < queryParameterStrings.length; i++) {
            var queryParameterString = queryParameterStrings[i];
            var queryParameterSplit = queryParameterString.split("=");
            var queryParameterKey = queryParameterSplit[0];
            var queryParameterValue = queryParameterSplit[1];
            if (queryParameterKey === ID3_QUERY_PARAMETERS.AD_ID) {
              parsedId3Object.adId = queryParameterValue;
            }
            else if (queryParameterKey === ID3_QUERY_PARAMETERS.TIME) {
              parsedId3Object.time = +queryParameterValue;
            }
            else if (queryParameterKey === ID3_QUERY_PARAMETERS.DURATION) {
              parsedId3Object.duration = +queryParameterValue;
            }
            else {
              OO.log("SSAI Pulse: " + queryParameterKey + " is an unrecognized query parameter.\n" +
                     "Recognized query parameters: " + _id3QueryParametersToString());
              parsedId3Object = null;
              break;
            }
          }
        }
        else {
          OO.log("SSAI Pulse: ID3 Metadata String contains" + queryParameterStrings.length +
                 "query parameters, but was expected to contain 3 query parameters: " +
                 _id3QueryParametersToString());
          parsedId3Object = null;
        }
      }
      return parsedId3Object;
    }, this);

    /**
     * Helper function to pretty print the ID3_QUERY_PARAMETERS object.
     * @private
     * @method SsaiPulse#_id3QueryParametersToString
     * @returns {string} The string: "adid, t, d".
     */
    var _id3QueryParametersToString = function() {
      var result = "";
      _.each(_.values(ID3_QUERY_PARAMETERS), function(value) {
        result = result + value + ", ";
      });
      result = result.slice(0, -2);
      return result;
    };

    /**
     * Temporary mock function to force an ad to play until live team fixes ad proxy.
     * @private
     * @method SsaiPulse#_forceMockAd
     * @param {object} id3Object The ID3 object
     */
    var _forceMockAd = function(id3Object) {
      var ad1 = {
        clickthrough: "http://www.google.com",
        name: "Test SSAI Ad",
        ssai: true,
        isLive: true
      };
      amc.forceAdToPlay(this.name, ad1, amc.ADTYPE.LINEAR_VIDEO, {}, id3Object.duration);
    };

    /**
     * Callback used when the duration of an ad has passed.
     * @private
     * @method SsaiPulse#_adEndedCallback
     */
    var _adEndedCallback = _.bind(function() {
      _clearAdDurationTimeout();
      if (this.currentAd) {
        amc.notifyLinearAdEnded(this.currentAd.id);
        amc.notifyPodEnded(this.currentAd.id);
      }
      adMode = false;
      this.currentAd = null;
    }, this);

    /**
     * Helper function to clear ad duration timeout.
     * @private
     * @method SsaiPulse#_clearAdDurationTimeout
     */
    var _clearAdDurationTimeout = function() {
      clearTimeout(adDurationTimeout);
      adDurationTimeout = null;
    };

    /**
     * Remove listeners from the Ad Manager Controller about playback.
     * @private
     * @method SsaiPulse#_removeAMCListeners
     */
    var _removeAMCListeners = _.bind(function() {
      if (amc) {
        amc.removePlayerListener(amc.EVENTS.CONTENT_CHANGED, _.bind(_onContentChanged, this));
        amc.removePlayerListener(amc.EVENTS.VIDEO_TAG_FOUND, _.bind(this.onVideoTagFound, this));
        amc.removePlayerListener(amc.EVENTS.CONTENT_URL_CHANGED, _.bind(this.onContentUrlChanged, this));
        amc.removePlayerListener(amc.EVENTS.FULLSCREEN_CHANGED, _.bind(this.onFullscreenChanged, this));
        amc.removePlayerListener(amc.EVENTS.AD_VOLUME_CHANGED, _.bind(this.onAdVolumeChanged, this));
      }
    }, this);
  };
  return new SsaiPulse();
});