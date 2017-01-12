import * as _ from 'lodash';
import * as Viz from 'viz.js';
import * as svgPanZoom from 'svg-pan-zoom';
import * as animate from '@f/animate';

import { getTypeGraphSelector, TypeGraph } from './type-graph';
import * as Actions from '../actions'

import { store, observeStore } from '../redux';

const xmlns = "http://www.w3.org/2000/svg";

import {
  removeClass,
  forEachNode
} from '../utils/';


export class Viewport {
  $svg: SVGElement;
  renderer: TypeGraph;
  zoomer: SvgPanZoom.Instance;

  constructor(public container: HTMLElement) {
    observeStore(getTypeGraphSelector, typeGraph => {
      if (typeGraph === null)
        return;

      this.renderer = new TypeGraph(typeGraph);
      this.render()
    });

    observeStore(state => state.selectedId, selectedId => {
      if (!this.$svg)
        return;

      this.deselectAll();

      if (selectedId === null) {
        this.$svg.classList.remove('selection-active');
        return;
      }

      this.$svg.classList.add('selection-active');
      var $selected = document.getElementById(selectedId);
      if ($selected.classList.contains('node'))
        this.selectNode($selected);
      else if ($selected.classList.contains('edge'))
        this.selectEdge($selected);
    });
  }

  render() {
    this.clear();
    let svgString = Viz(this.renderer.getDot());
    this.$svg = preprocessVizSvg(svgString);
    this.container.appendChild(this.$svg);
    this.enableZoom();
    this.bindClick();
    this.bindHover();
  }

  clear() {
    this.zoomer && this.zoomer.destroy();
    this.container.innerHTML = '';
  }

  enableZoom() {
    this.zoomer = svgPanZoom(this.$svg, {
      zoomScaleSensitivity: 0.3,
      minZoom: 0.9,
      controlIconsEnabled: true
    });
  }

  bindClick() {
    let dragged = false;

    let moveHandler = () => dragged = true;
    this.$svg.addEventListener('mousedown', event => {
      dragged = false;
      setTimeout(() => this.$svg.addEventListener('mousemove', moveHandler));
    });
    this.$svg.addEventListener('mouseup', event => {
      this.$svg.removeEventListener('mousemove', moveHandler);
      if (dragged) return;
      if (isLink(event.target as Element)) {
        this.panAndZoomToLink(event.target as Element);
      } else if (isNode(event.target as Element)) {
        let $node = getParent(event.target as Element, 'node');
        store.dispatch(Actions.selectElement($node.id));
      } else if (isEdge(event.target as Element)) {
        let $edge = getParent(event.target as Element, 'edge');
        store.dispatch(Actions.selectElement($edge.id));
      } else {
        if (isControl(event.target as SVGElement)) return;
        store.dispatch(Actions.clearSelection());
      }
    });
  }

  bindHover() {
    let $prevHovered = null;
    let $prevHoveredEdge = null;

    function clearSelection() {
      if ($prevHovered) $prevHovered.classList.remove('hovered');
      if ($prevHoveredEdge) $prevHoveredEdge.classList.remove('hovered');
    }

    this.$svg.addEventListener('mousemove', event => {
      let target = event.target as Element;
      if (isEdgeSource(target)) {
        let $sourceGroup = getParent(target, 'edge-source');
        if ($sourceGroup.classList.contains('hovered')) return;
        clearSelection();
        $sourceGroup.classList.add('hovered');
        $prevHovered = $sourceGroup;
        let edgeId = this.renderer.getEdgeBySourceId($sourceGroup.id).id;
        let $edge = document.getElementById(edgeId);
        $edge.classList.add('hovered');
        $prevHoveredEdge = $edge;
      } else {
        clearSelection();
      }
    });
  }

  selectNode(node:Element) {
    node.classList.add('selected');
    let inEdges = this.renderer.getInEdges(node.id);
    let outEdges = this.renderer.getOutEdges(node.id);

    let allEdges = _.union(inEdges, outEdges);

    _.each(allEdges, edge => {
      let $edge = document.getElementById(edge.id);
      $edge.classList.add('selected');
      let $node = document.getElementById(edge.nodeId);
      $node.classList.add('selected-reachable');
    });
  }

  selectEdge(edge:Element) {
    edge.classList.add('selected');
  }

  deselectAll() {
    let viewport = document.getElementById('viewport');
    removeClass(this.$svg, '.selected', 'selected');
    removeClass(this.$svg, '.selected-reachable', 'selected-reachable');
  }

  panAndZoomToLink(link: Element) {
    let nodeId = 'TYPE::' + link.textContent;

    let bbBox = document.getElementById(nodeId).getBoundingClientRect();
    let currentPan = this.zoomer.getPan();
    let viewPortSizes = (<any>this.zoomer).getSizes();

    currentPan.x += viewPortSizes.width/2 - bbBox.width/2;
    currentPan.y += viewPortSizes.height/2 - bbBox.height/2;

    let zoomUpdate = Math.max(bbBox.height / viewPortSizes.height, bbBox.width / viewPortSizes.width);
    zoomUpdate *= 1.2;

    let newZoom = this.zoomer.getZoom() / zoomUpdate;
    let newX = currentPan.x - bbBox.left;
    let newY = currentPan.y - bbBox.top;
    //zoomer.zoomAtPoint(newZoom, {x:newX, y:newY});
    this.animatePanAndZoom(newX , newY, newZoom);
  }

  animatePanAndZoom(x, y, zoomEnd) {
    let pan = this.zoomer.getPan();
    let panEnd = {x, y};
    animate(pan, panEnd, (props, t) => {
      this.zoomer.pan({x: props.x, y: props.y});
      if (props == panEnd) {
        let zoom = this.zoomer.getZoom();
        if (zoomEnd > zoom) return;
        animate({zoom}, {zoom: zoomEnd}, props => {
          this.zoomer.zoom(props.zoom);
        });
      }
    });
  }
}

export function preprocessVizSvg(svgString:string) {
  var wrapper = document.createElement('div');
  wrapper.innerHTML = svgString;
  var svg = <SVGElement>wrapper.firstElementChild;

  forEachNode(svg, 'a', $a => {
    let $g = $a.parentNode;

    var $docFrag = document.createDocumentFragment();
    while ($a.firstChild) {
        let $child = $a.removeChild($a.firstChild);
        $docFrag.appendChild($child);
    }

    $g.replaceChild($docFrag, $a);

    $g.id = $g.id.replace(/^a_/, '');
  });

  forEachNode(svg, 'title', $el => $el.remove());

  var displayedTypes = [];
  forEachNode(svg, '[id]', $el => {
    let [tag, ...restOfId] = $el.id.split('::');
    if (_.size(restOfId) < 1)
      return;

    $el.classList.add(tag.toLowerCase().replace(/_/, '-'));

    if (tag === 'TYPE')
      displayedTypes.push(restOfId[0]);
  });

  forEachNode(svg, 'g.edge path', $path => {
    let $newPath = $path.cloneNode() as HTMLElement;
    $newPath.classList.add('hover-path');
    $path.parentNode.appendChild($newPath);
  });

  forEachNode(svg, '.field', $field => {
    let texts = $field.querySelectorAll('text');
    texts[0].classList.add('field-name');
    texts[1].remove();

    for (var i = 2; i < texts.length; ++i) {
      texts[i].classList.add('field-type');
      var str = texts[i].innerHTML;
      if (displayedTypes.indexOf(str) !== -1) {
        texts[i].classList.add('type-link');
        $field.classList.add('edge-source');
      }
    }
  })

  forEachNode(svg, '.derived-type', $derivedType => {
    $derivedType.classList.add('edge-source');
    $derivedType.querySelector('text').classList.add('type-link');
  })

  forEachNode(svg, '.possible-type', $possibleType => {
    $possibleType.classList.add('edge-source');
    $possibleType.querySelector('text').classList.add('type-link');
  })

  wrapper.removeChild(svg);
  return svg;
}

function getParent(elem:Element, className:string): Element | null {
  while (elem && elem.tagName !== 'svg') {
    if (elem.classList.contains(className)) return elem;
    elem = elem.parentNode as Element;
  }
  return null;
}

function isNode(elem:Element):boolean {
  return getParent(elem, 'node') != null;
}

function isEdge(elem:Element):boolean {
  return getParent(elem, 'edge') != null;
}

function isLink(elem:Element):boolean {
  return elem.classList.contains('type-link');
}

function isEdgeSource(elem:Element):boolean {
  return getParent(elem, 'edge-source') != null;
}

function isControl(elem:SVGElement) {
  return elem.className.baseVal.startsWith('svg-pan-zoom');
}
