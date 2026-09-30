#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <unordered_map>
#include <vector>

namespace {
constexpr int N=96;
constexpr float HALF=0.72f;
constexpr int corner[8][3]={{0,0,0},{1,0,0},{1,1,0},{0,1,0},{0,0,1},{1,0,1},{1,1,1},{0,1,1}};
constexpr int edges[12][2]={{0,1},{1,2},{2,3},{3,0},{4,5},{5,6},{6,7},{7,4},{0,4},{1,5},{2,6},{3,7}};
constexpr int faces[6][4]={{0,1,2,3},{4,5,6,7},{0,9,4,8},{2,10,6,11},{3,11,7,8},{1,10,5,9}};
constexpr int faceSharedCorner[6]={1,5,1,2,3,2};
std::vector<uint8_t> grid;
std::vector<float> pos,normals;
std::vector<uint32_t> ind;
int occupied=0;
int id(int x,int y,int z){return (z*N+y)*N+x;}
float world(int i){return -HALF+2*HALF*i/(N-1);}
struct V {float x,y,z;};
V operator+(V a,V b){return {a.x+b.x,a.y+b.y,a.z+b.z};}
V operator-(V a,V b){return {a.x-b.x,a.y-b.y,a.z-b.z};}
V operator*(V a,float s){return {a.x*s,a.y*s,a.z*s};}
V cross(V a,V b){return {a.y*b.z-a.z*b.y,a.z*b.x-a.x*b.z,a.x*b.y-a.y*b.x};}
float dot(V a,V b){return a.x*b.x+a.y*b.y+a.z*b.z;}
float norm(V a){return std::sqrt(dot(a,a));}
void triangle(uint32_t a,uint32_t b,uint32_t c,V outward){
  V p={pos[3*a],pos[3*a+1],pos[3*a+2]},q={pos[3*b],pos[3*b+1],pos[3*b+2]},r={pos[3*c],pos[3*c+1],pos[3*c+2]};
  V n=cross(q-p,r-p);if(norm(n)<1e-9f)return;
  if(dot(n,outward)<0){std::swap(b,c);n=n*(-1);}
  ind.push_back(a);ind.push_back(b);ind.push_back(c);
  for(uint32_t i:{a,b,c}){normals[3*i]+=n.x;normals[3*i+1]+=n.y;normals[3*i+2]+=n.z;}
}
}
extern "C" {
int recon_build(const uint8_t* masks,const int* offsets,const int* widths,const int* heights,const float* cameras,int count){
  grid.assign(N*N*N,0);pos.clear();normals.clear();ind.clear();occupied=0;
  if(!masks||!offsets||!widths||!heights||!cameras||count<4||count>8)return 1;
  for(int v=0;v<count;++v){
    int w=widths[v],h=heights[v];if(w<8||h<8||w>2048||h>2048||offsets[v]<0)return 1;
    const float* K=cameras+21*v,*R=K+9,*t=R+9;
    for(int i=0;i<21;++i)if(!std::isfinite(K[i]))return 1;
    if(K[0]<=0||K[4]<=0||std::abs(K[8]-1)>0.01f)return 1;
    for(int row=0;row<3;++row){float length=0;
      for(int col=0;col<3;++col)length+=R[row*3+col]*R[row*3+col];
      if(std::abs(length-1)>0.02f)return 1;
      for(int other=row+1;other<3;++other){float overlap=0;
        for(int col=0;col<3;++col)overlap+=R[row*3+col]*R[other*3+col];
        if(std::abs(overlap)>0.02f)return 1;}
    }
    float determinant=R[0]*(R[4]*R[8]-R[5]*R[7])-R[1]*(R[3]*R[8]-R[5]*R[6])+R[2]*(R[3]*R[7]-R[4]*R[6]);
    if(std::abs(determinant-1)>0.02f)return 1;
  }
  // 外周を空に保つことで、抽出面が必ず閉じる。
  for(int z=1;z<N-1;++z)for(int y=1;y<N-1;++y)for(int x=1;x<N-1;++x){
    float wx=world(x),wy=world(y),wz=world(z);bool inside=true;
    for(int v=0;v<count;++v){
      const float* K=cameras+21*v,*R=K+9,*t=R+9;
      float cx=R[0]*wx+R[1]*wy+R[2]*wz+t[0];
      float cy=R[3]*wx+R[4]*wy+R[5]*wz+t[1];
      float cz=R[6]*wx+R[7]*wy+R[8]*wz+t[2];
      if(cz<=1e-5f){inside=false;break;}
      float px=(K[0]*cx+K[1]*cy)/cz+K[2];
      float py=(K[3]*cx+K[4]*cy)/cz+K[5];
      int ix=(int)std::floor(px+0.5f),iy=(int)std::floor(py+0.5f);
      if(ix<0||ix>=widths[v]||iy<0||iy>=heights[v]||masks[offsets[v]+iy*widths[v]+ix]==0){inside=false;break;}
    }
    if(inside){grid[id(x,y,z)]=1;++occupied;}
  }
  if(!occupied)return 2;
  std::unordered_map<uint64_t,uint32_t> vertexForEdge;
  for(int z=0;z<N-1;++z)for(int y=0;y<N-1;++y)for(int x=0;x<N-1;++x){
    int cubeIds[8];uint8_t filled[8];int countInside=0;V insideCenter={0,0,0},outsideCenter={0,0,0};
    for(int c=0;c<8;++c){int cx=x+corner[c][0],cy=y+corner[c][1],cz=z+corner[c][2];
      cubeIds[c]=id(cx,cy,cz);filled[c]=grid[cubeIds[c]];V p={world(cx),world(cy),world(cz)};
      if(filled[c]){insideCenter=insideCenter+p;++countInside;}else outsideCenter=outsideCenter+p;
    }
    if(!countInside||countInside==8)continue;
    V outward=outsideCenter*(1.0f/(8-countInside))-insideCenter*(1.0f/countInside);
    uint32_t vert[12];bool crossing[12]={};int adjacent[12][2];int degree[12]={};
    for(int e=0;e<12;++e){
      int a=edges[e][0],b=edges[e][1];if(filled[a]==filled[b])continue;
      crossing[e]=true;int low=std::min(cubeIds[a],cubeIds[b]),high=std::max(cubeIds[a],cubeIds[b]);
      uint64_t key=((uint64_t)low<<20)|(uint64_t)high;auto it=vertexForEdge.find(key);
      if(it!=vertexForEdge.end()){vert[e]=it->second;continue;}
      V p={(world(x+corner[a][0])+world(x+corner[b][0]))*0.5f,
           (world(y+corner[a][1])+world(y+corner[b][1]))*0.5f,
           (world(z+corner[a][2])+world(z+corner[b][2]))*0.5f};
      vert[e]=(uint32_t)(pos.size()/3);vertexForEdge[key]=vert[e];
      pos.push_back(p.x);pos.push_back(p.y);pos.push_back(p.z);normals.insert(normals.end(),{0,0,0});
    }
    auto connect=[&](int a,int b){if(degree[a]<2&&degree[b]<2){adjacent[a][degree[a]++]=b;adjacent[b][degree[b]++]=a;}};
    for(int f=0;f<6;++f){int active[4],n=0;
      for(int j=0;j<4;++j)if(crossing[faces[f][j]])active[n++]=j;
      if(n==2)connect(faces[f][active[0]],faces[f][active[1]]);
      else if(n==4){
        if(filled[faceSharedCorner[f]]){connect(faces[f][0],faces[f][1]);connect(faces[f][2],faces[f][3]);}
        else{connect(faces[f][1],faces[f][2]);connect(faces[f][3],faces[f][0]);}
      }
    }
    bool visited[12]={};
    for(int e=0;e<12;++e){if(!crossing[e]||visited[e]||degree[e]!=2)continue;
      int loop[12],length=0,current=e,previous=-1;
      do{if(length>=12)return 3;loop[length++]=current;visited[current]=true;
        int next=adjacent[current][0]==previous?adjacent[current][1]:adjacent[current][0];previous=current;current=next;
      }while(current!=e&&!visited[current]);
      if(current!=e||length<3)return 3;
      for(int j=1;j<length-1;++j)triangle(vert[loop[0]],vert[loop[j]],vert[loop[j+1]],outward);
    }
    if(pos.size()/3>800000||ind.size()/3>1600000)return 3;
  }
  if(ind.empty())return 2;
  // 面の向きと重心を保ったまま、最長軸1・底面Y=0にそろえる。
  V lo={1e9f,1e9f,1e9f},hi={-1e9f,-1e9f,-1e9f};
  for(size_t i=0;i<pos.size();i+=3){lo={std::min(lo.x,pos[i]),std::min(lo.y,pos[i+1]),std::min(lo.z,pos[i+2])};
    hi={std::max(hi.x,pos[i]),std::max(hi.y,pos[i+1]),std::max(hi.z,pos[i+2])};}
  float span=std::max({hi.x-lo.x,hi.y-lo.y,hi.z-lo.z});if(span<1e-7f)return 2;
  float mx=(lo.x+hi.x)*0.5f,mz=(lo.z+hi.z)*0.5f;
  for(size_t i=0;i<pos.size();i+=3){pos[i]=(pos[i]-mx)/span;pos[i+1]=(pos[i+1]-lo.y)/span;pos[i+2]=(pos[i+2]-mz)/span;
    V n={normals[i],normals[i+1],normals[i+2]};float length=norm(n);
    if(length>1e-9f){normals[i]/=length;normals[i+1]/=length;normals[i+2]/=length;}
  }
  return 0;
}
const float* recon_positions(){return pos.data();}
const uint32_t* recon_indices(){return ind.data();}
const float* recon_normals(){return normals.data();}
int recon_vertex_count(){return (int)pos.size()/3;}
int recon_index_count(){return (int)ind.size();}
int recon_occupied(){return occupied;}
const uint8_t* recon_slice(int z){return grid.data()+std::clamp(z,0,N-1)*N*N;}
}
