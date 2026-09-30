#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <limits>
#include <unordered_map>
#include <vector>

namespace {
constexpr int COARSE=96;
constexpr float HALF=0.72f;
constexpr float DIAGONAL=1.41421356237f;
constexpr int corner[8][3]={{0,0,0},{1,0,0},{1,1,0},{0,1,0},{0,0,1},{1,0,1},{1,1,1},{0,1,1}};
constexpr int edges[12][2]={{0,1},{1,2},{2,3},{3,0},{4,5},{5,6},{6,7},{7,4},{0,4},{1,5},{2,6},{3,7}};
constexpr int faces[6][4]={{0,1,2,3},{4,5,6,7},{0,9,4,8},{2,10,6,11},{3,11,7,8},{1,10,5,9}};
constexpr int faceSharedCorner[6]={1,5,1,2,3,2};
struct V {float x,y,z;};
struct View {
  const uint8_t* mask;
  int width,height;
  const float *K,*R,*t;
  std::vector<float> signedDistance;
};
std::vector<uint8_t> grid;
std::vector<float> values,pos,normals;
std::vector<uint32_t> ind;
std::array<float,4> normalization={0,0,0,1};
int side=COARSE,occupied=0,clipped=0;
float bounds[3][2]={{-HALF,HALF},{-HALF,HALF},{-HALF,HALF}};
int id(int x,int y,int z){return (z*side+y)*side+x;}
float world(int i,int axis){return bounds[axis][0]+(bounds[axis][1]-bounds[axis][0])*i/(side-1);}
V operator+(V a,V b){return {a.x+b.x,a.y+b.y,a.z+b.z};}
V operator-(V a,V b){return {a.x-b.x,a.y-b.y,a.z-b.z};}
V operator*(V a,float s){return {a.x*s,a.y*s,a.z*s};}
V cross(V a,V b){return {a.y*b.z-a.z*b.y,a.z*b.x-a.x*b.z,a.x*b.y-a.y*b.x};}
float dot(V a,V b){return a.x*b.x+a.y*b.y+a.z*b.z;}
float norm(V a){return std::sqrt(dot(a,a));}

std::vector<float> distanceTo(const uint8_t* mask,int w,int h,bool foreground){
  const float far=100000.0f;
  std::vector<float> result(w*h);
  for(int i=0;i<w*h;++i)result[i]=(bool(mask[i])==foreground)?0.0f:far;
  for(int y=0;y<h;++y)for(int x=0;x<w;++x){
    int i=y*w+x;
    if(x)result[i]=std::min(result[i],result[i-1]+1);
    if(y){
      result[i]=std::min(result[i],result[i-w]+1);
      if(x)result[i]=std::min(result[i],result[i-w-1]+DIAGONAL);
      if(x+1<w)result[i]=std::min(result[i],result[i-w+1]+DIAGONAL);
    }
  }
  for(int y=h-1;y>=0;--y)for(int x=w-1;x>=0;--x){
    int i=y*w+x;
    if(x+1<w)result[i]=std::min(result[i],result[i+1]+1);
    if(y+1<h){
      result[i]=std::min(result[i],result[i+w]+1);
      if(x)result[i]=std::min(result[i],result[i+w-1]+DIAGONAL);
      if(x+1<w)result[i]=std::min(result[i],result[i+w+1]+DIAGONAL);
    }
  }
  return result;
}
void prepareDistance(View& view){
  auto foreground=distanceTo(view.mask,view.width,view.height,true);
  auto background=distanceTo(view.mask,view.width,view.height,false);
  view.signedDistance.resize(view.width*view.height);
  for(size_t i=0;i<view.signedDistance.size();++i){
    view.signedDistance[i]=view.mask[i] ? 0.5f-background[i] : foreground[i]-0.5f;
  }
}
float project(const View& view,V p,bool smooth){
  const float* R=view.R,*t=view.t,*K=view.K;
  float cx=R[0]*p.x+R[1]*p.y+R[2]*p.z+t[0];
  float cy=R[3]*p.x+R[4]*p.y+R[5]*p.z+t[1];
  float cz=R[6]*p.x+R[7]*p.y+R[8]*p.z+t[2];
  if(cz<=1e-5f)return 1000;
  float px=(K[0]*cx+K[1]*cy)/cz+K[2];
  float py=(K[3]*cx+K[4]*cy)/cz+K[5];
  if(!smooth){
    int ix=(int)std::floor(px+0.5f),iy=(int)std::floor(py+0.5f);
    return ix<0||ix>=view.width||iy<0||iy>=view.height||!view.mask[iy*view.width+ix] ? 1.0f:-1.0f;
  }
  if(px<0||py<0||px>view.width-1||py>view.height-1)return 1000;
  int x=(int)px,y=(int)py,x1=std::min(x+1,view.width-1),y1=std::min(y+1,view.height-1);
  float fx=px-x,fy=py-y;
  const auto& d=view.signedDistance;
  float a=d[y*view.width+x]*(1-fx)+d[y*view.width+x1]*fx;
  float b=d[y1*view.width+x]*(1-fx)+d[y1*view.width+x1]*fx;
  return a*(1-fy)+b*fy;
}
float evaluate(const std::vector<View>& views,V p,bool smooth){
  float value=-1000;
  for(const auto& view:views)value=std::max(value,project(view,p,smooth));
  return value;
}
void triangle(uint32_t a,uint32_t b,uint32_t c,V outward){
  V p={pos[3*a],pos[3*a+1],pos[3*a+2]},q={pos[3*b],pos[3*b+1],pos[3*b+2]},r={pos[3*c],pos[3*c+1],pos[3*c+2]};
  V n=cross(q-p,r-p);if(norm(n)<1e-9f)return;
  if(dot(n,outward)<0){std::swap(b,c);n=n*(-1);}
  ind.push_back(a);ind.push_back(b);ind.push_back(c);
  for(uint32_t i:{a,b,c}){normals[3*i]+=n.x;normals[3*i+1]+=n.y;normals[3*i+2]+=n.z;}
}
bool validCamera(const float* K,const float* R){
  for(int i=0;i<21;++i)if(!std::isfinite(K[i]))return false;
  if(K[0]<=0||K[4]<=0||std::abs(K[8]-1)>0.01f)return false;
  for(int row=0;row<3;++row){
    float length=0;
    for(int col=0;col<3;++col)length+=R[row*3+col]*R[row*3+col];
    if(std::abs(length-1)>0.02f)return false;
    for(int other=row+1;other<3;++other){
      float overlap=0;
      for(int col=0;col<3;++col)overlap+=R[row*3+col]*R[other*3+col];
      if(std::abs(overlap)>0.02f)return false;
    }
  }
  float determinant=R[0]*(R[4]*R[8]-R[5]*R[7])-R[1]*(R[3]*R[8]-R[5]*R[6])+R[2]*(R[3]*R[7]-R[4]*R[6]);
  return std::abs(determinant-1)<=0.02f;
}
}
extern "C" {
int recon_build_options(const uint8_t* masks,const int* offsets,const int* widths,const int* heights,const float* cameras,int count,int requestedSide,int smooth,int adaptive){
  side=COARSE;occupied=0;clipped=0;grid.clear();values.clear();pos.clear();normals.clear();ind.clear();
  normalization={0,0,0,1};
  for(int axis=0;axis<3;++axis){bounds[axis][0]=-HALF;bounds[axis][1]=HALF;}
  if(!masks||!offsets||!widths||!heights||!cameras||count<4||count>8||
     (requestedSide!=COARSE)||(smooth!=0&&smooth!=1)||(adaptive!=0&&adaptive!=1))return 1;
  std::vector<View> views;
  for(int v=0;v<count;++v){
    int w=widths[v],h=heights[v];
    if(w<8||h<8||w>2048||h>2048||offsets[v]<0)return 1;
    const float* K=cameras+21*v,*R=K+9,*t=R+9;
    if(!validCamera(K,R))return 1;
    views.push_back({masks+offsets[v],w,h,K,R,t,{}});
  }
  if(adaptive){
    int lo[3]={COARSE,COARSE,COARSE},hi[3]={-1,-1,-1};
    for(int z=1;z<COARSE-1;++z)for(int y=1;y<COARSE-1;++y)for(int x=1;x<COARSE-1;++x){
      V p={-HALF+2*HALF*x/(COARSE-1),-HALF+2*HALF*y/(COARSE-1),-HALF+2*HALF*z/(COARSE-1)};
      if(evaluate(views,p,false)>=0)continue;
      int coord[3]={x,y,z};
      for(int axis=0;axis<3;++axis){lo[axis]=std::min(lo[axis],coord[axis]);hi[axis]=std::max(hi[axis],coord[axis]);}
    }
    if(hi[0]<0)return 2;
    for(int axis=0;axis<3;++axis)if(lo[axis]<=1||hi[axis]>=COARSE-2)clipped=1;
    if(!clipped)for(int axis=0;axis<3;++axis){
      bounds[axis][0]=-HALF+2*HALF*std::max(0,lo[axis]-4)/(COARSE-1);
      bounds[axis][1]=-HALF+2*HALF*std::min(COARSE-1,hi[axis]+4)/(COARSE-1);
    }
  }
  if(smooth)for(auto& view:views)prepareDistance(view);
  const size_t total=(size_t)side*side*side;
  grid.assign(total,0);values.assign(total,1);
  // 外周は空として閉じた面を保証する。
  for(int z=1;z<side-1;++z)for(int y=1;y<side-1;++y)for(int x=1;x<side-1;++x){
    V p={world(x,0),world(y,1),world(z,2)};
    float value=evaluate(views,p,smooth!=0);
    int index=id(x,y,z);values[index]=value;
    if(value<0){grid[index]=1;++occupied;}
  }
  if(!occupied)return 2;
  std::unordered_map<uint64_t,uint32_t> vertexForEdge;
  for(int z=0;z<side-1;++z)for(int y=0;y<side-1;++y)for(int x=0;x<side-1;++x){
    int cubeIds[8];uint8_t filled[8];int countInside=0;V insideCenter={0,0,0},outsideCenter={0,0,0};
    V points[8];
    for(int c=0;c<8;++c){
      int cx=x+corner[c][0],cy=y+corner[c][1],cz=z+corner[c][2];
      cubeIds[c]=id(cx,cy,cz);filled[c]=grid[cubeIds[c]];
      points[c]={world(cx,0),world(cy,1),world(cz,2)};
      if(filled[c]){insideCenter=insideCenter+points[c];++countInside;}
      else outsideCenter=outsideCenter+points[c];
    }
    if(!countInside||countInside==8)continue;
    V outward=outsideCenter*(1.0f/(8-countInside))-insideCenter*(1.0f/countInside);
    uint32_t vert[12];bool crossing[12]={};int adjacent[12][2];int degree[12]={};
    for(int e=0;e<12;++e){
      int a=edges[e][0],b=edges[e][1];if(filled[a]==filled[b])continue;
      crossing[e]=true;uint32_t low=std::min(cubeIds[a],cubeIds[b]),high=std::max(cubeIds[a],cubeIds[b]);
      uint64_t key=((uint64_t)low<<32)|high;auto it=vertexForEdge.find(key);
      if(it!=vertexForEdge.end()){vert[e]=it->second;continue;}
      float fraction=0.5f;
      if(smooth){
        float va=values[cubeIds[a]],vb=values[cubeIds[b]];
        if(std::abs(va-vb)>1e-6f)fraction=std::clamp(va/(va-vb),0.0f,1.0f);
      }
      V p=points[a]+(points[b]-points[a])*fraction;
      vert[e]=(uint32_t)(pos.size()/3);vertexForEdge[key]=vert[e];
      pos.push_back(p.x);pos.push_back(p.y);pos.push_back(p.z);normals.insert(normals.end(),{0,0,0});
    }
    auto connect=[&](int a,int b){if(degree[a]<2&&degree[b]<2){adjacent[a][degree[a]++]=b;adjacent[b][degree[b]++]=a;}};
    for(int f=0;f<6;++f){
      int active[4],n=0;
      for(int j=0;j<4;++j)if(crossing[faces[f][j]])active[n++]=j;
      if(n==2)connect(faces[f][active[0]],faces[f][active[1]]);
      else if(n==4){
        if(filled[faceSharedCorner[f]]){connect(faces[f][0],faces[f][1]);connect(faces[f][2],faces[f][3]);}
        else{connect(faces[f][1],faces[f][2]);connect(faces[f][3],faces[f][0]);}
      }
    }
    bool visited[12]={};
    for(int e=0;e<12;++e){
      if(!crossing[e]||visited[e]||degree[e]!=2)continue;
      int loop[12],length=0,current=e,previous=-1;
      do{
        if(length>=12)return 3;loop[length++]=current;visited[current]=true;
        int next=adjacent[current][0]==previous?adjacent[current][1]:adjacent[current][0];previous=current;current=next;
      }while(current!=e&&!visited[current]);
      if(current!=e||length<3)return 3;
      for(int j=1;j<length-1;++j)triangle(vert[loop[0]],vert[loop[j]],vert[loop[j+1]],outward);
    }
    if(pos.size()/3>800000||ind.size()/3>1600000)return 3;
  }
  if(ind.empty())return 2;
  V lo={1e9f,1e9f,1e9f},hi={-1e9f,-1e9f,-1e9f};
  for(size_t i=0;i<pos.size();i+=3){
    lo={std::min(lo.x,pos[i]),std::min(lo.y,pos[i+1]),std::min(lo.z,pos[i+2])};
    hi={std::max(hi.x,pos[i]),std::max(hi.y,pos[i+1]),std::max(hi.z,pos[i+2])};
  }
  float span=std::max({hi.x-lo.x,hi.y-lo.y,hi.z-lo.z});if(span<1e-7f)return 2;
  normalization={(lo.x+hi.x)*0.5f,lo.y,(lo.z+hi.z)*0.5f,span};
  for(size_t i=0;i<pos.size();i+=3){
    pos[i]=(pos[i]-normalization[0])/span;
    pos[i+1]=(pos[i+1]-normalization[1])/span;
    pos[i+2]=(pos[i+2]-normalization[2])/span;
    V n={normals[i],normals[i+1],normals[i+2]};float length=norm(n);
    if(length>1e-9f){normals[i]/=length;normals[i+1]/=length;normals[i+2]/=length;}
  }
  return 0;
}
int recon_build(const uint8_t* masks,const int* offsets,const int* widths,const int* heights,const float* cameras,int count){
  return recon_build_options(masks,offsets,widths,heights,cameras,count,96,0,0);
}
const float* recon_positions(){return pos.data();}
const uint32_t* recon_indices(){return ind.data();}
const float* recon_normals(){return normals.data();}
int recon_vertex_count(){return (int)pos.size()/3;}
int recon_index_count(){return (int)ind.size();}
int recon_occupied(){return occupied;}
int recon_side(){return side;}
int recon_clipped(){return clipped;}
const float* recon_normalization(){return normalization.data();}
const uint8_t* recon_slice(int z){return grid.data()+std::clamp(z,0,side-1)*side*side;}
}
