import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { defineMessages, injectIntl } from 'react-intl';
import cx from 'classnames';
import _ from 'lodash';
import { styles } from './styles';
import VideoListItemContainer from './video-list-item/container';
import { withDraggableConsumer } from '../../media/webcam-draggable-overlay/context';
import AutoplayOverlay from '../../media/autoplay-overlay/component';
import logger from '/imports/startup/client/logger';
import playAndRetry from '/imports/utils/mediaElementPlayRetry';

const propTypes = {
  users: PropTypes.arrayOf(PropTypes.object).isRequired,
  onMount: PropTypes.func.isRequired,
  getStats: PropTypes.func.isRequired,
  stopGettingStats: PropTypes.func.isRequired,
  enableVideoStats: PropTypes.bool.isRequired,
  webcamDraggableDispatch: PropTypes.func.isRequired,
  intl: PropTypes.objectOf(Object).isRequired,
};

const intlMessages = defineMessages({
  focusLabel: {
    id: 'app.videoDock.webcamFocusLabel',
  },
  focusDesc: {
    id: 'app.videoDock.webcamFocusDesc',
  },
  unfocusLabel: {
    id: 'app.videoDock.webcamUnfocusLabel',
  },
  unfocusDesc: {
    id: 'app.videoDock.webcamUnfocusDesc',
  },
  autoplayBlockedDesc: {
    id: 'app.videoDock.autoplayBlockedDesc',
  },
  autoplayAllowLabel: {
    id: 'app.videoDock.autoplayAllowLabel',
  },
});

const findOptimalGrid = (canvasWidth, canvasHeight, gutter, aspectRatio, numItems, columns = 1) => {
  const rows = Math.ceil(numItems / columns);
  const gutterTotalWidth = (columns - 1) * gutter;
  const gutterTotalHeight = (rows - 1) * gutter;
  const usableWidth = canvasWidth - gutterTotalWidth;
  const usableHeight = canvasHeight - gutterTotalHeight;
  let cellWidth = Math.floor(usableWidth / columns);
  let cellHeight = Math.ceil(cellWidth / aspectRatio);
  if ((cellHeight * rows) > usableHeight) {
    cellHeight = Math.floor(usableHeight / rows);
    cellWidth = Math.ceil(cellHeight * aspectRatio);
  }
  return {
    columns,
    rows,
    width: (cellWidth * columns) + gutterTotalWidth,
    height: (cellHeight * rows) + gutterTotalHeight,
    filledArea: (cellWidth * cellHeight) * numItems,
  };
};

const ASPECT_RATIO = 4 / 3;

class VideoList extends Component {
  constructor(props) {
    super(props);

    this.state = {
      focusedId: false,
      optimalGrid: {
        cols: 1,
        rows: 1,
        filledArea: 0,
      },
      autoplayBlocked: false,
      activePage: 1,
      show: true,
    };

    this.ticking = false;
    this.grid = null;
    this.canvas = null;
    this.failedMediaElements = [];
    this.handleCanvasResize = _.throttle(this.handleCanvasResize.bind(this), 66,
      {
        leading: true,
        trailing: true,
      });
    this.setOptimalGrid = this.setOptimalGrid.bind(this);
    this.handleAllowAutoplay = this.handleAllowAutoplay.bind(this);
    this.handlePlayElementFailed = this.handlePlayElementFailed.bind(this);
    this.autoplayWasHandled = false;
  }

  componentDidMount() {
    const { webcamDraggableDispatch } = this.props;
    webcamDraggableDispatch(
      {
        type: 'setVideoListRef',
        value: this.grid,
      },
    );

    this.handleCanvasResize();
    window.addEventListener('resize', this.handleCanvasResize, false);
    window.addEventListener('videoPlayFailed', this.handlePlayElementFailed);
  }

  componentWillUnmount() {
    window.removeEventListener('resize', this.handleCanvasResize, false);
    window.removeEventListener('videoPlayFailed', this.handlePlayElementFailed);
  }

  setOptimalGrid() {
    const { users } = this.props;
    // let numItems = users.length;
    let numItems = this.LimitUser;
    if (numItems < 1 || !this.canvas || !this.grid) {
      return;
    }

    const { focusedId } = this.state;
    const { width: canvasWidth, height: canvasHeight } = this.canvas.getBoundingClientRect();

    const gridGutter = parseInt(window.getComputedStyle(this.grid)
      .getPropertyValue('grid-row-gap'), 10);
    const hasFocusedItem = numItems > 2 && focusedId;
    // Has a focused item so we need +3 cells
    if (hasFocusedItem) {
      numItems += 3;
    }
    const optimalGrid = _.range(1, numItems + 1)
      .reduce((currentGrid, col) => {
        const testGrid = findOptimalGrid(
          canvasWidth, canvasHeight, gridGutter,
          ASPECT_RATIO, numItems, col,
        );
        // We need a minimun of 2 rows and columns for the focused
        // const focusedConstraint = hasFocusedItem ? testGrid.rows > 1 && testGrid.columns > 1 : true;
        const betterThanCurrent = testGrid.filledArea > currentGrid.filledArea;
        return betterThanCurrent ? testGrid : currentGrid;
      }, { filledArea: 0 });
    this.setState({
      optimalGrid,
    });
  }

  handleAllowAutoplay() {
    const { autoplayBlocked } = this.state;

    logger.info({
      logCode: 'video_provider_autoplay_allowed',
    }, 'Video media autoplay allowed by the user');

    this.autoplayWasHandled = true;
    window.removeEventListener('videoPlayFailed', this.handlePlayElementFailed);
    while (this.failedMediaElements.length) {
      const mediaElement = this.failedMediaElements.shift();
      if (mediaElement) {
        const played = playAndRetry(mediaElement);
        if (!played) {
          logger.error({
            logCode: 'video_provider_autoplay_handling_failed',
          }, 'Video autoplay handling failed to play media');
        } else {
          logger.info({
            logCode: 'video_provider_media_play_success',
          }, 'Video media played successfully');
        }
      }
    }
    if (autoplayBlocked) { this.setState({ autoplayBlocked: false }); }
  }

  handlePlayElementFailed(e) {
    const { mediaElement } = e.detail;
    const { autoplayBlocked } = this.state;

    e.stopPropagation();
    this.failedMediaElements.push(mediaElement);
    if (!autoplayBlocked && !this.autoplayWasHandled) {
      logger.info({
        logCode: 'video_provider_autoplay_prompt',
      }, 'Prompting user for action to play video media');
      this.setState({ autoplayBlocked: true });
    }
  }

  handleVideoFocus(id) {
    const { focusedId } = this.state;
    this.setState({
      focusedId: focusedId !== id ? id : false,
    }, this.handleCanvasResize);
    window.dispatchEvent(new Event('videoFocusChange'));
  }

  handleCanvasResize() {
    if (!this.ticking) {
      window.requestAnimationFrame(() => {
        this.ticking = false;
        this.setOptimalGrid();
      });
    }
    this.ticking = true;
  }

  checkMe(LimitPage) {
    // console.log("---------------------");

    // console.log('checkMe:', LimitPage);
    // console.log('isMe:', this.isMe);
    // console.log('show:', this.state.show);
    // console.log("---------------------");

    if (LimitPage === 0 && this.page === 0 && this.isMe != undefined) {
      if (this.state.show == true) {
        return -1
      } else if (this.state.show == false) {
        return 1
      }
    }
    else {
      return 1
    }

    // amount.map((e, i) => {
    //   console.log(i);

    //   if (!i) {
    //     return -1
    //   } else {
    //     return 1
    //   }
    // })
  }

  renderVideoList(pageNumber) {

    const {
      intl,
      users,
      onMount,
      getStats,
      stopGettingStats,
      enableVideoStats,
      swapLayout,
    } = this.props;
    const { focusedId } = this.state;
    const pageSize = 6;

    if (pageNumber == undefined) {
      pageNumber = 1;
    }
    let pageIndex = pageNumber; //******************
    let totalPage = Math.ceil(users.length / pageSize)
    let offset = (pageIndex - 1) * pageSize;
    let LimitUsers = [...users];
    let LimitPage = [...users];
    let status = false;
    if (LimitUsers.length > 1) {
      LimitUsers = LimitUsers.slice(offset, offset + pageSize);
    }

    // console.log('user', users);
    // console.log('LimitUsers', LimitUsers);

    // this.isMe = LimitUsers[0]['sortName']
    this.isMe = users[0]['sortName']
    this.page = offset
    this.offset = offset + LimitUsers.length
    this.LimitPage = LimitPage.length
    this.LimitUser = LimitUsers.length

    // console.log('page', this.page);
    // console.log('offset', this.offset);
    // console.log('LimitUser', this.LimitUser);
    console.log('LimitPage', this.LimitPage);

    if (this.LimitUser == 0 && this.offset == this.LimitPage) {
      this.setState({
        activePage: this.state.activePage - 1
      });
    }

    if (LimitUsers.length >= 2) {
      status = true;
    }

    console.log('status', status);

    return LimitUsers.map((user, LimitPage) => {
      const isFocused = focusedId === user.userId;
      const isFocusedIntlKey = !isFocused ? 'focus' : 'unfocus';
      let actions = [];

      if (LimitUsers.length > 2) {
        actions = [{
          label: intl.formatMessage(intlMessages[`${isFocusedIntlKey}Label`]),
          description: intl.formatMessage(intlMessages[`${isFocusedIntlKey}Desc`]),
          onClick: () => this.handleVideoFocus(user.userId),
        }];
      }
      return (
        <div
          key={user.userId}
          className={cx({
            [styles.videoListItem]: true,
            [styles.focused]: focusedId === user.userId && LimitUsers.length > 2,
          })}
        // style={{ transform: `scaleX(${this.checkMe(LimitPage)})` }}
        >
          <VideoListItemContainer
            numOfUsers={LimitUsers.length}
            user={user}
            actions={actions}
            onMount={(videoRef) => {
              this.handleCanvasResize();
              onMount(user.userId, videoRef);
            }}
            getStats={(videoRef, callback) => getStats(user.userId, videoRef, callback)}
            stopGettingStats={() => stopGettingStats(user.userId)}
            enableVideoStats={enableVideoStats}
            swapLayout={swapLayout}
            transformVideos={this.checkMe(LimitPage)}
          />
        </div>
      );
    });
  }

  render() {
    const { users, intl, activ } = this.props;
    const { optimalGrid, autoplayBlocked } = this.state;

    const canvasClassName = cx({
      [styles.videoCanvas]: true,
    });

    const videoListClassName = cx({
      [styles.videoList]: true,
    });

    // console.log('setState Videos', this.setState);

    let prev;
    let next;

    if (this.state.activePage >= 2) {
      prev = <button class={[styles.h_button_left]} style={{ height: `${optimalGrid.height - 50}px`, margin: "0 12px", }} onClick={() => {
        this.setState({
          activePage: this.state.activePage - 1
        });
        // this.renderVideoList(this.state.activePage);
      }
      }>
        <i class="icon-bbb-left_arrow" style={{ color: "black" }} aria-hidden="true"></i>

      </button>
    } else if (this.isMe != undefined) {
      if (this.state.show == true) {
        prev = <button class={[styles.h_button_right_v]} style={{ height: `30px`, width: `30px`, position: "absolute", top: "0px", zIndex: "1" }} title="Mirror Camera" onClick={() => {
          this.setState({
            show: this.state.show = false
          });
        }
        }>
          <i class="icon-bbb-refresh" style={{ color: "black" }} aria-hidden="true"></i>
        </button>
      } else if (this.state.show == false) {
        prev = <button class={[styles.h_button_right_v]} style={{ height: `30px`, width: `30px`, position: "absolute", top: "0px", zIndex: "1" }} title="Mirror Camera" onClick={() => {
          this.setState({
            show: this.state.show = true
          });
        }
        }>
          <i class="icon-bbb-refresh" style={{ color: "black" }} aria-hidden="true"></i>
        </button>
      }
    }

    if (this.state.activePage <= 16 && this.offset < this.LimitPage) {
      next = <button class={[styles.h_button_right]} style={{ height: `${optimalGrid.height - 50}px`, margin: "0 12px" }} onClick={() => {
        this.setState({
          activePage: this.state.activePage + 1
        });
        // this.renderVideoList(this.state.activePage);
      }
      }>
        <i class="icon-bbb-right_arrow" style={{ color: "black" }} aria-hidden="true"></i>

      </button>
    }

    return (
      <div>
        <div
          ref={(ref) => {
            this.canvas = ref;
          }}
          className={canvasClassName}
        >
          <div >
            {prev}
          </div>
          {/* {users.map(user => console.log("user: ", user)
          )} */}
          {!users.length ? null : (
            <div
              ref={(ref) => {
                this.grid = ref;
              }}
              className={videoListClassName}
              style={{
                // width: `${178 * this.LimitUser}px`,
                width: `${optimalGrid.width}px`,
                height: `${optimalGrid.height}px`,
                // transform: `scaleX(-1)`,
                // gridTemplateColumns: `repeat(${this.LimitUser}, 1fr)`,
                gridTemplateColumns: `repeat(${optimalGrid.columns}, 1fr)`,
                gridTemplateRows: `repeat(${optimalGrid.rows}, 1fr)`,
              }}
            >
              {this.renderVideoList(this.state.activePage)}
              <i class="fa fa-chevron-right" aria-hidden="true"></i>
            </div>
          )}
          {!autoplayBlocked ? null : (
            <AutoplayOverlay
              autoplayBlockedDesc={intl.formatMessage(intlMessages.autoplayBlockedDesc)}
              autoplayAllowLabel={intl.formatMessage(intlMessages.autoplayAllowLabel)}
              handleAllowAutoplay={this.handleAllowAutoplay}
            />
          )}
          {next}
        </div>

      </div >
    );

  }

}

VideoList.propTypes = propTypes;

export default injectIntl(withDraggableConsumer(VideoList));
